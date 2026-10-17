/* Status led drivers are implemented using TCA9534 I2C I/O expanders.
 * The status led's are connected between the outputs of the two TCA9534's.
 * The status led's are of the type 3SBCC-F.
 * IC6 is connected to 3SBCC-F pin 1 (cathode for the green led).
 * IC7 is connected to 3SBCC-F pin 2 (cathode for the red led), through a 150Ohm resistor.
 *
 * IR diodes are controlled by an DAC output from a MCP47FEB02A2, via a op-amp and MOSFET.
 * The Op-amp ensures that the current through the IR diodes is proportional to the voltage output from the DAC.
 * Initialize the DAC with gain 1 and Vref = 2 * 1.22V (internal reference).
 * Observer the note in the DAC datasheet function diagram, that internal reference voltage is 2 * internal band gap.
 * The current in mA though each IR diode is then 0.5 * D - 12.61, where D is the digital value sent to the DAC.
 * So, set the digital value to 2 * I(mA per diode) + 25. 
 * There is a voltage compensation build around the op-amp, which gives this +25, that ensures that we can turn the diodes completely off.
 * The 9 IR diodes it positioned with 3 parallel strings, each consisting of 3 diodes.
 * The voltage to the diodes comes from a 5V2 step-up converter.
 * It is DAC output 0 which control the IR LEDS.
 * DAC output 1 can either function as reference for the ADC, or it can control a small yellow LED. Dependent on PCB configuration.
 * 
 * The IR photodiodes is converted with a 12-bit ADC ADS7828, normal use is with internal 2.5V reference.
 * With PCB modifications it is possible to use DAC1 as external reference for the ADC.
*/

//% color=#2876A8 icon="\uf1e6" block="LineSensor8Pixel"
namespace LineSensor8Pixel {
    let statusLedIC7Addr = 0x20;
    let statusLedIC6Addr = 0x21;
    let dacICAddr = 0x62;
    let adcICAddr = 0x48;

    let tca9534OutputRegister = 0x01;
    let tca9534ControlRegister = 0x03;
    let statusLedIC6Outputs = 0x0;
    let statusLedIC7Outputs = 0x0;

    let dacReadRegisterMask = 0x6;
    let dacNonVolatileRegisters = 0x80;
    let dac0OutputRegister = 0x00;
    let dac1OutputRegister = 0x08;
    let dacRefRegister = 0x40;
    let dacPDRegister = 0x48;
    let dacGainRegister = 0x50;

    let LowPassDepth = 2;
    let MinContrast = 75 * LowPassDepth;
    let whiteLineThreshold = 750;
    let blackLineThreshold = 200;
    let lineData = [0, 0, 0, 0, 0, 0, 0, 0];
    let linePos = 0;
    //let sensorGain = [15620, 14077, 13980, 13727, 13431, 12835, 13275, 13834];
    //let sensorOffset = [-11, -22, -26, -26, -16, -29, -18, -14];
    // background around 700
    // Factor between groups should be in the area 1.1 - 1.15

    export enum LineData {
        //% block="Baggrund"
        Background = 0,
        //% block="Linje"
        Line = 1
    }

    export enum LineStatus {
        //% block="Ingen linje"
        NoLine = 0,
        //% block="Linje fundet"
        LineFound = 1,
        //% block="Udgrening"
        Junction = 4,
        //% block="Udgrening venstre"
        JunctionLeft = 8,
        //% block="Udgrening højre"
        JuntionRight = 16,
        //% block="Hvid udgrening venstre"
        WhiteJunctionLeft = 32,
        //% block="Hvid udgrening højre"
        WhiteJunctionRight = 64,
        //% block="Sort udgrening venstre"
        BlackJunctionLeft = 128,
        //% block="Sort udgrening højre"
        BlackJunctionRight = 256,
        //% block="Kryds"
        Cross = 512,
        //% block="Krydser hvid"
        WhiteLineCrossing = 1024,
        //% block="Krydser sort"
        BlackLineCrossing = 2048,
        Unknown = 4096
    }

    let lineStatus = LineStatus.Unknown;

    export enum LedColor {
        //% block="rød"
        Red = 0,
        //% block="grøn"
        Green = 1,
        //% block="slukket"
        Off = 2
    }
/*
    export enum Intensity {
        //% block="lysere"
        Lighter = 0,
        //% block="mørkere"
        Darker = 1
    }
*/
    export enum LineColor {
        //% block="sort"
        Black = 0,
        //% block="hvid"
        White = 1
    }
/*
    let blackIntensity = Intensity.Darker;
    let whiteIntensity = Intensity.Lighter;
*/    
    let searchLineColor = LineColor.Black;

    function tca9534WriteRegister(addr: number, reg: number, value: number): void {
        let b = pins.createBuffer(2);
        b[0] = reg & 0xff;
        b[1] = value & 0xff;
        pins.i2cWriteBuffer(addr, b);
    }

    function dacWriteRegister(addr: number, reg: number, value: number): void {
        let b = pins.createBuffer(3);
        b[0] = reg & 0xff;
        b[1] = (value >> 8) & 0xff;
        b[2] = value & 0xff;
        pins.i2cWriteBuffer(addr, b);
    }

    function dacWaitEEPROMReady(): void {
        while(true) {
            pins.i2cWriteNumber(dacICAddr, dacGainRegister | dacReadRegisterMask,
                NumberFormat.UInt8BE, true);

            // Status-registeret er 16 bit, MSB først
            const status = pins.i2cReadNumber(dacICAddr, NumberFormat.UInt16BE);
            if (status & 0x0040) basic.pause(1);
            else return;
        }
    }

    //% blockID="linesensor8Pixel_initializeDACEEPROMRegisters"
    //% block="Initialiser DAC EEPROM registre, kun nødvendigt en gang"
    export function initializeDACEEPROMRegisters(): void {
        dacWaitEEPROMReady();
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dac0OutputRegister, 0x0000);
        dacWaitEEPROMReady();
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dac1OutputRegister, 0x00ff); // As LED is connected between 3V3 and DAC, this turns off the LED.
        dacWaitEEPROMReady();
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dacRefRegister, 0x0000); // This sets Ref to Vdd, whch saves power.
        dacWaitEEPROMReady();
        dacWriteRegister(dacICAddr, dacNonVolatileRegisters | dacPDRegister, 0x000D); // Set DAC0 to 1kOhm pull-down, and DAC1 to high-Z.
        dacWaitEEPROMReady();
    }

    /** Read a single-ended ADS7828 channel (0..4095). */
    //% blockID="linesensor8Pixel_adcRead"
    //% block="Læs sensor %channel"
    //% channel.min=1 channel.max=8
    export function adcRead(channel: number): number {
        if (channel < 1 || channel > 8) return 0;
        let ch = channel - 1;
        // Refer to datasheet for channel order
        // Even channel sel = channel number divided by 2
        // Odd channel sel = 4 + channel number divided by 2
        let sel = ch >> 1;
        if(ch & 0x01) sel |= 0x04;
        let cmd = 0x80 | (sel << 4) | 0x0c; // single-ended, power-down = Vref on, adc on
        pins.i2cWriteNumber(adcICAddr, cmd, NumberFormat.UInt8BE, false)
        let b = pins.i2cReadBuffer(adcICAddr, 2, false)
        return ((b[0] << 8) | b[1]) & 0x0fff
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
        dacWriteRegister(dacICAddr, dacRefRegister, 0x0001); // Set Vref for DAC1 to Vdd, and 2 * 1.22V for DAC0
        dacWriteRegister(dacICAddr, dacGainRegister, 0x0000); // Set gain to 1
        dacWriteRegister(dacICAddr, dacPDRegister, 0x0000); // Set DAC0 and DAC1 to normal operation

        adcRead(1);
        basic.pause(1); // Wait for ADC internal ref to stabilize
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
                ic6Output |= ledBit & 0xff;
                ic7Output &= ~ledBit & 0xff;
                break;
            case LedColor.Green:
                ic6Output &= ~ledBit & 0xff;
                ic7Output |= ledBit & 0xff;
                break;
            case LedColor.Off:
                ic6Output &= ~ledBit & 0xff;
                ic7Output &= ~ledBit & 0xff;
                break;
        }
        if (ic6Output != statusLedIC6Outputs) {
            statusLedIC6Outputs = ic6Output;
            tca9534WriteRegister(statusLedIC6Addr, tca9534OutputRegister, statusLedIC6Outputs);
        }
        if (ic7Output != statusLedIC7Outputs) {
            statusLedIC7Outputs = ic7Output;
            tca9534WriteRegister(statusLedIC7Addr, tca9534OutputRegister, statusLedIC7Outputs);
        }
    }

    //% blockID="linesensor8Pixel_setDAC1Output"
    //% block="Sæt DAC 1 output til $value"
    //% value.min=0 value.max=255
    export function setDAC1Output(value: number): void {
        dacWriteRegister(dacICAddr, dac1OutputRegister, value & 0xff);
    }

    //% blockID="linesensor8Pixel_setIRLedCurrent"
    //% block="Sæt IR LED strøm til $current_mA mA"
    //% current_mA.min=0 current_mA.max=90
    export function setIRLedCurrent(current_mA: number): void {
        let dacValue = 0;
        if (current_mA > 0) {
            dacValue = Math.round(2 * current_mA + 25);
        }
        if (dacValue > 205) dacValue = 205; // This limits the IR diode current to theoritical 90mA, max allowed DC current is 100mA.
        dacWriteRegister(dacICAddr, dac0OutputRegister, dacValue & 0xff);
    }

/*
    //% blockID="linesensor8Pixel_setLineIntensity"
    //% block="Baggrund er $black end sort linje og $white end hvid"
    export function setLineIntensity(black: Intensity, white: Intensity): void
    {
        blackIntensity = (black == Intensity.Lighter ? Intensity.Darker : Intensity.Lighter);
        whiteIntensity = (white == Intensity.Lighter ? Intensity.Darker : Intensity.Lighter);
    }
*/

    //% blockID="linesensor8Pixel_setLineSearch"
    //% block="Indstil til at finde $color"
    export function setLineSearch(color: LineColor): void
    {
        searchLineColor = color;
    }

    //% blockID="linesensor8Pixel_setLowPassDepth"
    //% block="Sæt lavpasfilter dybde $depth"
    export function setLowPassDepth(depth: number): void {
        MinContrast /= LowPassDepth;
        LowPassDepth = Math.round(depth);
        MinContrast = Math.round(MinContrast * LowPassDepth);
    }

    //% blockID="linesensor8Pixel_setMinContrast"
    //% block="Sæt min linje kontrast $contrast"
    export function setMinThreshold(contrast: number): void {
        MinContrast = contrast * LowPassDepth;
    }

    //% blockID="linesensor8Pixel_getLineStatus"
    //% block="linje status"
    export function getLineStatus(): LineStatus {
        return lineStatus;
    }

    //% blockID="linesensor8Pixel_getLinePos"
    //% block="linje position [-100:100]"
    export function getLinePos(): number {
        return linePos;
    }

    function updateStatusLeds(data: number[]): void {
        let ic6Output = 0;
        let ic7Output = 0;
        for(let ch = 0; ch < 8; ch++) {
            let ledBit = 1 << ch;
/*            
            if(data[ch] == LineStatusColor.Black) 
            {
                ic6Output |= ledBit & 0xff;
                ic7Output &= ~ledBit & 0xff;
            }
*/
            if(data[ch] == LineData.Line) {
                ic6Output &= ~ledBit & 0xff;
                ic7Output |= ledBit & 0xff;
            }
        }
        if (ic6Output != statusLedIC6Outputs) {
            statusLedIC6Outputs = ic6Output;
            tca9534WriteRegister(statusLedIC6Addr, tca9534OutputRegister, statusLedIC6Outputs);
        }
        if (ic7Output != statusLedIC7Outputs) {
            statusLedIC7Outputs = ic7Output;
            tca9534WriteRegister(statusLedIC7Addr, tca9534OutputRegister, statusLedIC7Outputs);
        }
    }
/*
    export function sortSensorData(data: number[]): {sorted: number[], sortedIndex: number[]}
    {
        let sortedSensorData = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
        let diodeToSortedIndex = [-1, -1, -1, -1, -1, -1, -1, -1];
        for(let i = 0; i < 8; i++) {
            let v = data[i];
            for(let j = 0; j < 8; j++) {
                if (sortedSensorData[j] > v) {
                    sortedSensorData.removeAt(sortedSensorData.length - 1);
                    sortedSensorData.insertAt(j, v);
                    diodeToSortedIndex.removeAt(diodeToSortedIndex.length - 1);
                    diodeToSortedIndex.insertAt(j, i);
                    break;
                }
            }
        }
        return {sorted: sortedSensorData, sortedIndex: diodeToSortedIndex};
    }

    function calcMean(data: number[], incl: number, excl: number): number
    {
        let avg = 0;
        for (let i = incl; i < excl; i++) avg += data[i];
        avg /= (excl - incl);
        return avg;
    }

    function calcGroupVarianceSquared(data: number[], incl: number, excl: number): number {
        let varianceSquared = 0;
        let avg = calcMean(data, incl, excl);
        for(let i = incl; i< excl; i++)
        {
            let d = data[i] - avg;
            varianceSquared += d * d;
        }
        return varianceSquared;
    }

    export function groupData(data: number[]): {grp2Start: number, grp3Start: number}
    {
        let lowestError = Infinity;
        let bestGrp2Start = -1;
        let bestGrp3Start = -1;
        for(let grp2Start = 1; grp2Start < data.length - 1; grp2Start++) {
            for(let grp3Start = grp2Start + 1; grp3Start < data.length; grp3Start++) {
                let error =
                    calcGroupVarianceSquared(data, 0, grp2Start) +
                    calcGroupVarianceSquared(data, grp2Start, grp3Start) +
                    calcGroupVarianceSquared(data, grp3Start, data.length);
                if(error < lowestError)
                {
                    lowestError = error;
                    bestGrp2Start = grp2Start;
                    bestGrp3Start = grp3Start;
                }
            }
        }
        return {grp2Start: bestGrp2Start, grp3Start: bestGrp3Start};
    }

    function evaluateGroups(data: number[], grp: {grp2Start: number, grp3Start: number}): { grp2Start: number, grp3Start: number }
    {
        let meanGrp1 = calcMean(data, 0, grp.grp2Start);
        let meanGrp2 = calcMean(data, grp.grp2Start, grp.grp3Start);
        let meanGrp3 = calcMean(data, grp.grp3Start, data.length);

        serial.writeLine("M1: " + meanGrp1 + " M2: " + meanGrp2 + " M3: " + meanGrp3);

        let diffGrp21 = meanGrp2 - meanGrp1;
        let diffGrp32 = meanGrp3 - meanGrp2;
        let meanFactor12 = meanGrp2 / meanGrp1;
        let meanFactor32 = meanGrp3 / meanGrp2;

        if (diffGrp21 > minMeanDifferenceBetweenGroups && 
            diffGrp32 > minMeanDifferenceBetweenGroups &&
            meanFactor12 > minFactorBetweenGroups &&
            meanFactor32 > minFactorBetweenGroups)
        {
            // We have three groups
            return grp;
        }

        // We know that we have at most two groups
        // It will always be the middle group which we join with one of the other groups
        // We join it with the group closest to the middle group
        let groupDivider = 0;
        let meanLow = 0;
        let meanHigh = 0;
        if(diffGrp21 > diffGrp32)
        {
            groupDivider = grp.grp2Start;
            meanLow = meanGrp1;
            meanHigh = calcMean(data, groupDivider, 8);
        }
        else 
        {
            groupDivider = grp.grp3Start;
            meanLow = calcMean(data, 0, groupDivider);
            meanHigh = meanGrp3;
        }

        serial.writeLine("ML: " + meanLow + " MH: " + meanHigh);
        if((meanHigh - meanLow) > minMeanDifferenceBetweenGroups &&
        (meanHigh / meanLow) > minFactorBetweenGroups)
        {
            // We have two groups
            return {grp2Start: groupDivider, grp3Start: 8};
        }
        // We only have one group
        return {grp2Start: 8, grp3Start: 8};
    }

    function evaluateData(data: number[])
    {
        let sortedData = sortSensorData(data);
        let initialGroups = groupData(sortedData.sorted);
        let groups = evaluateGroups(sortedData.sorted, initialGroups);

        let str = "SensorData: ";
        for (let i = 0; i < sensorData.length; i++) str += sensorData[i] + " ";
        serial.writeLine(str);

        str = "Sorted: ";
        for(let i = 0; i < sortedData.sortedIndex.length; i++) str += sortedData.sortedIndex[i] + " ";
        serial.writeLine(str);
        serial.writeLine("Initial: " + initialGroups.grp2Start + " - " + initialGroups.grp3Start);
        serial.writeLine("Groups: " + groups.grp2Start + " - " + groups.grp3Start);

        lineData.fill(0);
        lineStatus = LineStatus.NoLine;
        if(groups.grp2Start == 8) {
            // No line found
            return;
        }

        let group1 = (blackIntensity == Intensity.Darker ? LineStatusColor.Black : LineStatusColor.Background);
        let group2 = (group1 == LineStatusColor.Background ? LineStatusColor.Black :
            (whiteIntensity == Intensity.Lighter ? LineStatusColor.Background : LineStatusColor.White));
        let group3 = (group2 == LineStatusColor.White ? LineStatusColor.Background : LineStatusColor.White);

        if(groups.grp3Start == -1) {
            // One line color found
            if(searchLineColor == LineColor.White) {
                group1 = (whiteIntensity == Intensity.Lighter ? LineStatusColor.Background : LineStatusColor.White);
                group2 = (group1 == LineStatusColor.Background ? LineStatusColor.White : LineStatusColor.Background);
                lineStatus = LineStatus.WhiteLine;
            }
            else {
                group1 = (blackIntensity == Intensity.Darker ? LineStatusColor.Black : LineStatusColor.Background);
                group2 = (group1 == LineStatusColor.Background ? LineStatusColor.Black : LineStatusColor.Background);
                lineStatus = LineStatus.BlackLine;
            }
        }
        else lineStatus = LineStatus.WhiteAndBlackLine;

        for(let i = 0; i < groups.grp2Start; i++) {
            lineData[sortedData.sortedIndex[i]] = group1;
        }
        for (let i = groups.grp2Start; i < groups.grp3Start; i++) {
            lineData[sortedData.sortedIndex[i]] = group2;
        }
        for (let i = groups.grp3Start; i < 8; i++) {
            lineData[sortedData.sortedIndex[i]] = group3;
        }
    }
*/

    // Returns a value in the range [-100;100]
    function calcWeigthedLinePos(data: number[], line: number[]) : number {
        let sum = 0;
        let sumw = 0;
        for(let i = 0; i < 8; i++) {
            if(line[i] != LineData.Background) {
                sum += line[i];
                sumw += line[i] * (3.5 - i);
            }
        }
        return Math.round((sumw / sum) * 12.5);
    }

    function threshold(data: number[]): number[] {
        let mean = 0;
        let minVal = Infinity;
        let maxVal = 0;
        for(let i = 0; i < 8; i++) {
            mean += data[i];
            if(data[i] < minVal) minVal = data[i];
            if(data[i] > maxVal) maxVal = data[i];
        }
        mean /= 8;
        
        let median = (maxVal - minVal) / 2 + minVal;
        let threshold = Math.max(mean, median);

        serial.writeLine("Range: " + minVal + " - " + maxVal + " mean: " + mean + " median: " + median + " threshold: " + threshold);

        let line = [0, 0, 0, 0, 0, 0, 0, 0];
        if (minVal + MinContrast > threshold) {
            serial.writeLine("No contrast");
            lineStatus = LineStatus.NoLine;
            return line;
        }
        
        lineStatus = LineStatus.LineFound;
        for(let i = 0; i < 8; i++) {
            if(data[i] > threshold) line[i] = LineData.Line;
        }
        return line;
    }

    function equalize(data: number[]): void {
        let minVal = Infinity;
        let maxVal = 0;
        for(let i = 0; i < 8; i++) {
            if(data[i] < minVal) minVal = data[i];
            if(data[i] > maxVal) maxVal = data[i];
        }
        if(searchLineColor == LineColor.Black) {
            for(let i = 0; i < 8; i++) {
                data[i] = (maxVal - minVal) - data[i];
            }
        }
    }

    //% blockID="linesensor8Pixel_sample"
    //% block="Opdater"
    export function sample(): void {
        let background = [0, 0, 0, 0, 0, 0, 0, 0];
        let foreground = [0, 0, 0, 0, 0, 0, 0, 0];
        let lowestVal = 10000;
        let highestVal = 0;

        for(let lowPassCnt = 0; lowPassCnt < LowPassDepth; lowPassCnt++) {
            for (let ch = 0; ch < 8; ch++) {
                let val = adcRead(ch + 1);
                background[ch] += val;
                if (val < lowestVal) lowestVal = val;
                if (val > highestVal) highestVal = val;
            }
            setIRLedCurrent(90);
            for (let ch = 0; ch < 8; ch++) {
                let val = adcRead(ch + 1);
                foreground[ch] += val;
                if (val < lowestVal) lowestVal = val;
                if (val > highestVal) highestVal = val;
            }
            setIRLedCurrent(0);
        }
        let data = [0, 0, 0, 0, 0, 0, 0, 0];
        let str = "Sensor";
        for (let ch = 0; ch < 8; ch++) {
            let val = foreground[ch] - background[ch];
            if(val < 0) val = 0;
            data[ch] = val;
            str += " : " + val;
//            sensorData[ch] += sensorOffset[ch];
//            if(sensorData[ch] < 0) sensorData[ch] = 0;
//            sensorData[ch] *= sensorGain[ch];
//           sensorData[ch] >>= 10;
        }
        serial.writeLine(str);

        equalize(data);
        str = "Equalized";
        for(let i = 0; i < 8; i++) str += " : " + data[i];
        serial.writeLine(str);
        lineData = threshold(data);
        updateStatusLeds(lineData);
        linePos = calcWeigthedLinePos(data, lineData);
    }

/*
    //% blockID="linesensor8Pixel_getSensorData"
    //% block="Sensor data"
    export function getSensorData(): number[] {
        return sensorData;
    }

    //% blockID="linesensor8Pixel_getLowestRawValue"
    //% block="Lavest rå sensor værdi"
    export function getLowestRawValue(): number {
        return lowestRawValue;
    }

    //% blockID="linesensor8Pixel_getHighestRawValue"
    //% block="Højeste rå sensor værdi"
    export function getHighestRawValue(): number {
        return highestRawValue;
    }

    function readSensorLowPass(count: number): number[] {
        let lowPass = [0, 0, 0, 0, 0, 0, 0, 0];
        for(let i = 0; i < count; i++) {
            sample();
            for(let ch = 0; ch < 8; ch++) {
                lowPass[ch] += sensorData[ch];
            }
        }
        for(let ch = 0; ch < 8; ch++) {
            lowPass[ch] /= count;
        }
        return lowPass;
    }

    //% blockID="linesensor8Pixel_calibrateGain"
    //% block="Kalibrer gains på hvid streg, efter der er kalibreret offset på sort streg"
    export function calibrateGain(): number[]
    {
        sensorGain = [1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024];
        let data = readSensorLowPass(30);
        let gains = [0, 0, 0, 0, 0, 0, 0, 0];
        for(let ch = 0; ch < 8; ch++) {
            gains[ch] = Math.round(1024 * 10000 / (data[ch]));
        }
        sensorGain = gains;
        return gains;
    }

    //% blockID="linesensor8Pixel_calibrateOffset"
    //% block="Kalibrer offset på sort streg, før der kalibreres gains på hvid streg"
    export function calibrateOffset(): number[]
    {
        sensorGain = [1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024];
        sensorOffset = [0, 0, 0, 0, 0, 0, 0, 0];
        let data = readSensorLowPass(30);
        let offset = [0, 0, 0, 0, 0, 0, 0, 0];
        for(let ch = 0; ch < 8; ch++) {
            offset[ch] = 100 - Math.round(data[ch]);
        }
        sensorOffset = offset;
        return offset;
    }
    */
}
