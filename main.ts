/* Status led drivers are implemented using TCA9534 I2C I/O expanders.
 * The status led's are connected between the outputs of the two TCA9534's.
 * The status led's are of the type 3SBCC-F.
 * IC6 is connected to 3SBCC-F pin 1 (cathode for the green led).
 * IC7 is connected to 3SBCC-F pin 2 (cathode for the red led), through a 150Ohm resistor.
 *
 * IR diodes are controlled by an DAC output from a MCP47FEB02A2, via a op-amp and MOSFET.
 * The Op-amp ensures that the current through the IR diodes is proportional to the voltage output from the DAC.
 * Initialize the DAC with gain 2 and Vref = 1.22V (internal reference).
 * The current in mA though each IR diode is then 0.5 * D - 12.61, where D is the digital value sent to the DAC.
 * So, set the digital value to 2 * I(mA per diode) + 25. 
 * There is a voltage compensation build around the op-amp, which gives this +25, that ensures that we can turn the diodes completely off.
 * The 9 IR diodes it positioned with 3 parallel strings, each consisting of 3 diodes.
 * The voltage to the diodes comes from a 5V2 step-up converter.
 * It is DAC output 0 which control the IR LEDS.
 * DAC output 1 can either function as reference for the ADC, or it can control a small yellow LED. Dependent on PCB configuration.
*/

//% color=#2876A8 icon="\uf1e6" block="LineSensor8Pixel"
namespace LineSensor8Pixel {
    let statusLedIC7Addr = 0x20;
    let statusLedIC6Addr = 0x21;
    let tca9534OutputRegister = 0x01;
    let tca9534ControlRegister = 0x03;
    let statusLedIC6Outputs = 0x0;
    let statusLedIC7Outputs = 0x0;

    let dacICAddr = 0x62;
    let dacNonVolatileRegisters = 0x10;
    let dac0OutputRegister = 0x00;
    let dac1OutputRegister = 0x01;
    let dacRefRegister = 0x08;
    let dacPDRegister = 0x09;
    let dacGainRegister = 0x0A;

    export enum LedColor {
        //% block="rød"
        Red = 0,
        //% block="grøn"
        Green = 1,
        //% block="slukket"
        Off = 2
    }

    function tca9534WriteRegister(addr: number, reg: number, value: number): void {
        let b = pins.createBuffer(2);
        b[0] = reg & 0xff;
        b[1] = value & 0xff;
        pins.i2cWriteBuffer(addr, b);
    }

    //% blockID="linesensor8Pixel_setStatusLed"
    //% block="Sæt LED $led til farve $color"
    //% led.min=1 led.max=8
    export function setStatusLed(led: number, color: LedColor): void {
        let ic6Output = statusLedIC6Outputs;
        let ic7Output = statusLedIC7Outputs;
        let ledBit = 1 << (led - 1);
        switch (color) {
            case LedColor.Red:
                ic6Output |= (ledBit & 0xff);
                ic7Output &= ~(ledBit & 0xff);
                break;
            case LedColor.Green:
                ic6Output &= (~ledBit & 0xff);
                ic7Output |= (ledBit & 0xff);
                break;
            case LedColor.Off:
                ic6Output &= (~ledBit & 0xff);
                ic7Output &= (~ledBit & 0xff);
                break;
        }
        if(ic6Output != statusLedIC6Outputs) {
            statusLedIC6Outputs = ic6Output;
            tca9534WriteRegister(statusLedIC6Addr, tca9534OutputRegister, statusLedIC6Outputs);
        }
        if(ic7Output != statusLedIC7Outputs) {
            statusLedIC7Outputs = ic7Output;
            tca9534WriteRegister(statusLedIC7Addr, tca9534OutputRegister, statusLedIC7Outputs);
        }
    }

    function dacWriteRegister(addr: number, reg: number, value: number): void {
        let b = pins.createBuffer(3);
        b[0] = reg & 0xff;
        b[1] = (value >> 8) & 0xff;
        b[2] = value & 0xff;
        pins.i2cWriteBuffer(addr, b);
    }

    //% blockID="linesensor8Pixel_initializeDACEEPROMRegisters"
    //% block="Initialiser DAC EEPROM registre, kun nødvendigt en gang"
    export function initializeDACEEPROMRegisters(): void {
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dac0OutputRegister, 0x0000);
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dac1OutputRegister, 0x00ff); // As LED is connected between 3V3 and DAC, this turns off the LED.
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dacRefRegister, 0x0000); // This sets Ref to Vdd, whch saves power.
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dacPDRegister, 0x000D); // Set DAC0 to 1kOhm pull-down, and DAC1 to high-Z.
    }

    //% blockID="linesensor8Pixel_setDAC0Output"
    //% block="Sæt DAC 0 output til $value"
    //% value.min=0 value.max=255
    export function setDAC1Output(value: number): void {
        dacWriteRegister(dacICAddr, dac1OutputRegister, value & 0xff);
    }

    //% blockID="linesensor8Pixel_setIRLedCurrent"
    //% block="Sæt IR LED strøm til $current_mA mA"
    //% current_mA.min=0 current_mA.max=90
    export function setIRLedCurrent(current_mA: number): void {
        let dacValue = 0;
        if(current_mA > 0) {
            dacValue = Math.round(2 * current_mA + 25);
        }
        if (dacValue > 205) dacValue = 205; // This limits the IR diode current to theoritical 90mA, max allowed DC current is 100mA.
        dacWriteRegister(dacICAddr, dac0OutputRegister, dacValue & 0xff);
    }

    //% blockID="linesensor8Pixel_init"
    //% block="Initialiser LineSensor8Pixel"
    export function initLinesensor8Pixel(): void {
        // Setup status led's
        // Initialize the TCA9534 I/O expanders with zeros in output registers
        tca9534WriteRegister(statusLedIC6Addr, tca9534OutputRegister, statusLedIC6Outputs);
        tca9534WriteRegister(statusLedIC7Addr, tca9534OutputRegister, statusLedIC7Outputs);

        // Initialize TCA9534's pins as outputs.
        tca9534WriteRegister(statusLedIC6Addr, tca9534ControlRegister, 0x00);
        tca9534WriteRegister(statusLedIC7Addr, tca9534ControlRegister, 0x00);

        // Setup DAC
        dacWriteRegister(dacICAddr, dac0OutputRegister, 0x0000);
        dacWriteRegister(dacICAddr, dac1OutputRegister, 0x0000); // As LED is connected between 3V3 and DAC, this turns on the LED
        dacWriteRegister(dacICAddr, dacRefRegister, 0x0001); // Set Vref for DAC1 to Vdd, and 1.22V for DAC0
        dacWriteRegister(dacICAddr, dacGainRegister, 0x0100); // Set gain to 1 for DAC1 and 2 for DAC0
        dacWriteRegister(dacICAddr, dacPDRegister, 0x0000); // Set DAC0 and DAC1 to normal operation
    }
}
