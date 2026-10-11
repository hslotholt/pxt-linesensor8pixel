/* Status led drivers are implemented using TCA9534 I2C I/O expanders.
 * The status led's are connected between the outputs of the two TCA9534's.
 * The status led's are of the type 3SBCC-F.
 * IC6 is connected to 3SBCC-F pin 1 (cathode for the green led).
 * IC7 is connected to 3SBCC-F pin 2 (cathode for the red led), through a 150Ohm resistor.
*/

//% color=#2876A8 icon="\uf1e6" block="LineSensor8Pixel"
namespace LineSensor8Pixel {
    let statusLedIC7Addr = 0x20;
    let statusLedIC6Addr = 0x21;
    let statusLedIC6Outputs = 0x0;
    let statusLedIC7Outputs = 0x0;

    export enum LedColor {
        //% block="rød"
        Red = 0,
        //% block="grøn"
        Green = 1,
        //% block="slukket"
        Off = 2
    }

    //% blockID="linesensor8Pixel_init"
    //% block="Initialiser LineSensor8Pixel"
    export function initLinesensor8Pixel(): void {
        // Setup status led's
        // Initialize the TCA9534 I/O expanders with zeros in output registers
        pins.i2cWriteNumber(statusLedIC6Addr, 0x01, NumberFormat.UInt8BE, true);
        pins.i2cWriteNumber(statusLedIC6Addr, statusLedIC6Outputs, NumberFormat.UInt8BE, false);
        pins.i2cWriteNumber(statusLedIC7Addr, 0x01, NumberFormat.UInt8BE, true);
        pins.i2cWriteNumber(statusLedIC7Addr, statusLedIC7Outputs, NumberFormat.UInt8BE, false);

        // Initialize TCA9534's pins as outputs.
        pins.i2cWriteNumber(statusLedIC6Addr, 0x03, NumberFormat.UInt8BE, true);
        pins.i2cWriteNumber(statusLedIC6Addr, 0x0, NumberFormat.UInt8BE, false);
        pins.i2cWriteNumber(statusLedIC7Addr, 0x03, NumberFormat.UInt8BE, true);
        pins.i2cWriteNumber(statusLedIC7Addr, 0x0, NumberFormat.UInt8BE, false);
    }

    //% blockID="linesensor8Pixel_setStatusLed"
    //% block="Sæt LED $led til farve $color"
    //% led.min=1 led.max=8
    export function setStatusLed(led: number, color: LedColor): void {
        let ic6Output = statusLedIC6Outputs;
        let ic7Output = statusLedIC7Outputs;
        let ledBit = 1 << led;
        switch (color) {
            case LedColor.Red:
                ic6Output |= ledBit;
                ic7Output &= ~ledBit;
                break;
            case LedColor.Green:
                ic6Output &= ~ledBit;
                ic7Output |= ledBit;
                break;
            case LedColor.Off:
                ic6Output &= ~ledBit;
                ic7Output &= ~ledBit;
                break;
        }
        if(ic6Output != statusLedIC6Outputs) {
            statusLedIC6Outputs = ic6Output;
            pins.i2cWriteNumber(statusLedIC6Addr, 0x01, NumberFormat.UInt8BE, true);
            pins.i2cWriteNumber(statusLedIC6Addr, statusLedIC6Outputs, NumberFormat.UInt8BE, false);
        }
        if(ic7Output != statusLedIC7Outputs) {
            statusLedIC7Outputs = ic7Output;
            pins.i2cWriteNumber(statusLedIC7Addr, 0x01, NumberFormat.UInt8BE, true);
            pins.i2cWriteNumber(statusLedIC7Addr, statusLedIC7Outputs, NumberFormat.UInt8BE, false);
        }
    }
}
