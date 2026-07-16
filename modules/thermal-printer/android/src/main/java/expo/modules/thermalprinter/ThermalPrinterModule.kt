package expo.modules.thermalprinter

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID

// The well-known Serial Port Profile UUID. Every Bluetooth Classic ESC/POS
// thermal printer exposes its byte stream on this service.
private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

// Printers are slow. The socket must not close while bytes are still draining,
// or the tail of the receipt (i.e. the total) never reaches the paper.
private const val DRAIN_MILLIS = 400L

class PrinterException(message: String) : CodedException(message)

class ThermalPrinterModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw PrinterException("No Android context available")

  private fun adapter(): BluetoothAdapter =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter
      ?: throw PrinterException("This device has no Bluetooth hardware")

  /**
   * From Android 12 (API 31) reading bonded devices or opening a socket needs
   * the runtime BLUETOOTH_CONNECT grant; below 31 the install-time BLUETOOTH
   * permission is enough. JS asks for the grant — this is the backstop so a
   * missing one surfaces as a readable message, not a SecurityException.
   */
  private fun requireConnectPermission() {
    // Context.checkSelfPermission is API 23+, and minSdk is well past that, so
    // this avoids depending on androidx.core being on the module's classpath.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val granted = context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)
      if (granted != PackageManager.PERMISSION_GRANTED) {
        throw PrinterException("Bluetooth permission not granted")
      }
    }
  }

  private fun requireEnabledAdapter(): BluetoothAdapter {
    val a = adapter()
    if (!a.isEnabled) throw PrinterException("Bluetooth is switched off")
    return a
  }

  override fun definition() = ModuleDefinition {
    Name("ThermalPrinter")

    // Cheap and synchronous: is there Bluetooth hardware at all?
    Function("isAvailable") {
      try {
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter != null
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("isEnabled") {
      try {
        adapter().isEnabled
      } catch (e: Exception) {
        false
      }
    }

    // Only *paired* devices — pairing stays Android's job, so we never need the
    // BLUETOOTH_SCAN grant nor the location permission that discovery drags in.
    AsyncFunction("getBondedPrinters") {
      requireConnectPermission()
      requireEnabledAdapter().bondedDevices.map {
        mapOf("name" to (it.name ?: "Unknown"), "address" to it.address)
      }
    }

    // Raw ESC/POS bytes, built in JS (src/lib/thermal.ts). Keeping the byte
    // layout on the JS side means the receipt can change without a native rebuild.
    AsyncFunction("printBytes") { address: String, bytes: List<Int> ->
      requireConnectPermission()
      val a = requireEnabledAdapter()

      val device = a.bondedDevices.firstOrNull { it.address.equals(address, ignoreCase = true) }
        ?: throw PrinterException("Printer $address is not paired any more — pair it in Android settings")

      val payload = ByteArray(bytes.size) { i -> (bytes[i] and 0xFF).toByte() }

      var socket: BluetoothSocket? = null
      try {
        socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
        // An in-flight discovery makes connect() slow and flaky.
        // cancelDiscovery() needs BLUETOOTH_SCAN which we deliberately skip,
        // so swallow the SecurityException — it's a nice-to-have, not critical.
        try { a.cancelDiscovery() } catch (_: SecurityException) { }
        socket.connect()
        socket.outputStream.apply {
          write(payload)
          flush()
        }
        Thread.sleep(DRAIN_MILLIS)
        true
      } catch (e: IOException) {
        throw PrinterException("Could not reach the printer — is it on and in range? (${e.message})")
      } catch (e: SecurityException) {
        throw PrinterException("Bluetooth permission denied")
      } finally {
        try { socket?.close() } catch (_: Exception) { }
      }
    }
  }
}
