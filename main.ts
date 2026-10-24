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
    let lineData = [0, 0, 0, 0, 0, 0, 0, 0];
    let linePos = 0;

    export enum LedColor {
        //% block="rød"
        Red = 0,
        //% block="grøn"
        Green = 1,
        //% block="slukket"
        Off = 2
    }

    export enum LineColor {
        //% block="sort"
        Black = 0,
        //% block="hvid"
        White = 1
    }

    export enum BranchPreference {
        //% block="venstre"
        Left = 0,
        //% block="højre"
        Right = 1
    }

    export enum LineData {
        //% block="Baggrund"
        Background = 0,
        //% block="Linje"
        Line = 1,
        //% block="Fravalgt spor / udgrening"
        Junction = 2
    }

    export enum LineStatus {
        //% block="Ingen linje"
        NoLine = 0,
        //% block="Linje fundet"
        LineFound = 1,
        //% block="Udgrening"
        Junction = 2,
        //% block="Udgrening venstre"
        JunctionLeft = 4,
        //% block="Udgrening højre"
        JuntionRight = 8,
        //% block="Hvid udgrening venstre"
        WhiteJunctionLeft = 16,
        //% block="Hvid udgrening højre"
        WhiteJunctionRight = 32,
        //% block="Sort udgrening venstre"
        BlackJunctionLeft = 64,
        //% block="Sort udgrening højre"
        BlackJunctionRight = 128,
        //% block="Kryds"
        Cross = 256,
        //% block="Krydser hvid"
        WhiteLineCrossing = 512,
        //% block="Krydser sort"
        BlackLineCrossing = 1024,
        //% block="Baggrund ændret"
        BackgroundChanged = 2048,
    }

    let lineStatus = LineStatus.NoLine;
    let branchPreference = BranchPreference.Left;
    let sensorInitialized = false;
    let sensorInitializing = false;
    let samplingLoopStarted = false;
    let samplingBusy = false;
    let requestedPeriodMs = 30;
    let lastSampleTime = -1;
    let lastSampleDurationMs = 0;
    let lastSampleIntervalMs = 0;
    let maxSampleIntervalMs = 0;
    let rawSignal = [0, 0, 0, 0, 0, 0, 0, 0];
    let learnedLine = 0;
    let learnedBackground = 0;
    let referenceReady = false;
    let haveLineReference = false;
    let haveBackgroundReference = false;
    let referenceTimeS = 0.7;
    let previousTrackCentre = 3.5;
    let expectedWidth = 2;
    let mainTrackSeen = false;
    let junctionCount = 0;
    let branchCount = 0;
    let lineLossCount = 0;
    let uncleanCount = 0;
    let visibilityState = 0; // 0 unknown, 1 visible, 2 lost
    let visibilityCandidate = 0;
    let visibilitySamples = 0;
    let cleanlinessState = 0; // 0 unknown, 1 clean, 2 not clean
    let cleanlinessCandidate = 0;
    let cleanlinessSamples = 0;
    let lineFoundCount = 0;
    let lineWasVisible = false;
    let crossingCount = 0;
    let eventActive = false;
    let eventCandidateSamples = 0;
    let eventClearSamples = 0;
    let candidateBits = 0;
    let activeBits = 0;
    let confirmSamples = 2;
    let clearSamples = 3;


    /*
        export enum Intensity {
            //% block="lysere"
            Lighter = 0,
            //% block="mørkere"
            Darker = 1
        }
    */
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
        while (true) {
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
        if (ch & 0x01) sel |= 0x04;
        let cmd = 0x80 | (sel << 4) | 0x0c; // single-ended, power-down = Vref on, adc on
        pins.i2cWriteNumber(adcICAddr, cmd, NumberFormat.UInt8BE, false)
        let b = pins.i2cReadBuffer(adcICAddr, 2, false)
        return ((b[0] << 8) | b[1]) & 0x0fff
    }

    //% blockID="linesensor8Pixel_init"
    //% block="Initialiser LineSensor8Pixel"
    export function initLinesensor8Pixel(): void {
        if (sensorInitialized || sensorInitializing) return;
        sensorInitializing = true;
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
        sensorInitialized = true;
        sensorInitializing = false;
        startSamplingLoop();
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
    //% block="Følg $color linje og hold til $preference ved udgrening"
    export function setLineSearch(color: LineColor, preference: BranchPreference = BranchPreference.Left): void {
        if (searchLineColor != color) resetTracking();
        searchLineColor = color;
        branchPreference = preference;
    }

    //% blockID="linesensor8Pixel_setLowPassDepth"
    //% block="Sæt lavpasfilter dybde $depth"
    export function setLowPassDepth(depth: number): void {
        MinContrast /= LowPassDepth;
        LowPassDepth = Math.max(1, Math.round(depth));
        MinContrast = Math.round(MinContrast * LowPassDepth);
    }

    //% blockID="linesensor8Pixel_setMinContrast"
    //% block="Sæt min linje kontrast $contrast"
    export function setMinThreshold(contrast: number): void {
        MinContrast = contrast * LowPassDepth;
    }

    //% blockId="linesensor8Pixel_hasLine"
    //% block="linje fundet?"
    export function hasLine(): boolean {
        return sensorInitialized && getSampleAgeMs() <= 100 &&
            (lineStatus & LineStatus.LineFound) != 0;
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
        for (let ch = 0; ch < 8; ch++) {
            // Logical 0 is robot-left, which is physical ADC/LED channel 8.
            let ledBit = 1 << (7 - ch);
            if (data[ch] == LineData.Line) ic7Output |= ledBit;
            else if (data[ch] == LineData.Junction) ic6Output |= ledBit;
        }
        if (ic6Output != statusLedIC6Outputs) {
            statusLedIC6Outputs = ic6Output;
            tca9534WriteRegister(statusLedIC6Addr, tca9534OutputRegister, ic6Output);
        }
        if (ic7Output != statusLedIC7Outputs) {
            statusLedIC7Outputs = ic7Output;
            tca9534WriteRegister(statusLedIC7Addr, tca9534OutputRegister, ic7Output);
        }
    }

    function calcWeigthedLinePos(data: number[], classification: number[]): number {
        let sum = 0;
        let sumw = 0;
        for (let ch = 0; ch < 8; ch++) {
            // A rejected branch must NOT contribute to the centroid.
            if (classification[ch] == LineData.Line) {
                sum += data[ch];
                sumw += data[ch] * (3.5 - ch);
            }
        }
        if (sum <= 0) return linePos;
        return Math.max(-100, Math.min(100, Math.round(sumw / sum * 100 / 3.5)));
    }

    function resetTracking(): void {
        referenceReady = false;
        haveBackgroundReference = false;
        haveLineReference = false;
        previousTrackCentre = 3.5;
        expectedWidth = 2;
        mainTrackSeen = false;
        lineWasVisible = false;
        visibilityState = 0;
        visibilityCandidate = 0;
        visibilitySamples = 0;
        cleanlinessState = 0;
        cleanlinessCandidate = 0;
        cleanlinessSamples = 0;
        lineStatus = LineStatus.NoLine;
        linePos = 0;
        eventActive = false;
        eventCandidateSamples = 0;
        eventClearSamples = 0;
        candidateBits = 0;
        activeBits = 0;
        lastSampleTime = -1;
    }

    function updateEvent(bits: number): void {
        // Keep the entire passage latched and count only once.
        if (bits != 0) {
            candidateBits |= bits;
            eventClearSamples = 0;
            if (!eventActive) {
                eventCandidateSamples++;
                if (eventCandidateSamples >= confirmSamples) {
                    eventActive = true;
                    activeBits = candidateBits;
                    junctionCount++;
                    if ((activeBits & LineStatus.Cross) == 0) branchCount++;
                    if ((activeBits & LineStatus.Cross) != 0) crossingCount++;
                }
            } else {
                // A junction may broaden into a crossing during one passage.
                if ((bits & LineStatus.Cross) != 0 && (activeBits & LineStatus.Cross) == 0) crossingCount++;
                activeBits |= bits;
            }
        } else {
            eventCandidateSamples = 0;
            candidateBits = 0;
            if (eventActive) {
                eventClearSamples++;
                if (eventClearSamples >= clearSamples) {
                    eventActive = false;
                    activeBits = 0;
                    eventClearSamples = 0;
                }
            }
        }
        if (eventActive) lineStatus |= activeBits | LineStatus.Junction;
    }

    // Confirm visibility and cleanliness independently. Counters retain even
    // a confirmed event that ended before the next motor tick.
    function updateLineConditions(visible: boolean, clean: boolean): void {
        let state = visible ? 1 : 2;
        if (state != visibilityCandidate) {
            visibilityCandidate = state;
            visibilitySamples = 0;
        }
        visibilitySamples++;
        if (visibilitySamples >= confirmSamples && visibilityState != state) {
            visibilityState = state;
            if (state == 2) lineLossCount++;
        }
        state = clean ? 1 : 2;
        if (state != cleanlinessCandidate) {
            cleanlinessCandidate = state;
            cleanlinessSamples = 0;
        }
        cleanlinessSamples++;
        if (cleanlinessSamples >= confirmSamples && cleanlinessState != state) {
            cleanlinessState = state;
            if (state == 2) uncleanCount++;
        }
    }

    // One completed, ambient-subtracted measurement, averaged over LowPassDepth.
    // No fixed black/white signal levels or mandatory calibration are used.
    function processLine(raw: number[], dt: number): void {
        let minimum = raw[0];
        let maximum = raw[0];
        let mean = 0;
        for (let ch = 0; ch < 8; ch++) {
            minimum = Math.min(minimum, raw[ch]);
            maximum = Math.max(maximum, raw[ch]);
            mean += raw[ch];
        }
        mean /= 8;
        let minContrast = Math.max(1, MinContrast / LowPassDepth);
        let weights = [0, 0, 0, 0, 0, 0, 0, 0];
        let mask = [0, 0, 0, 0, 0, 0, 0, 0];
        let starts: number[] = [];
        let ends: number[] = [];
        let count = 0;
        let threshold = (minimum + maximum) / 2;
        if (!referenceReady) {
            // Bootstrap from ordinary spatial contrast, as in the original code.
            let transformedMean = searchLineColor == LineColor.Black ? maximum - mean : mean;
            let transformedMin = searchLineColor == LineColor.Black ? 0 : minimum;
            let transformedMid = searchLineColor == LineColor.Black ? (maximum - minimum) / 2 : threshold;
            let t = Math.max(transformedMean, transformedMid);
            if (t - transformedMin >= minContrast) {
                for (let ch = 0; ch < 8; ch++) {
                    weights[ch] = searchLineColor == LineColor.Black ? maximum - raw[ch] : raw[ch];
                    if (weights[ch] > t) mask[ch] = 1;
                }
            }
        } else {
            // Match the learned FOLLOWED line, not every departure from background.
            let span = learnedLine - learnedBackground;
            for (let ch = 0; ch < 8; ch++) {
                let likeness = (raw[ch] - learnedBackground) / span;
                if (likeness >= 0.5) mask[ch] = 1;
                weights[ch] = Math.max(0, likeness);
            }
        }
        for (let ch = 0; ch < 8; ch++) {
            if (mask[ch] != 0) {
                count++;
                if (ch == 0 || mask[ch - 1] == 0) starts.push(ch);
                if (ch == 7 || mask[ch + 1] == 0) ends.push(ch);
            }
        }
        lineData = [0, 0, 0, 0, 0, 0, 0, 0];
        lineStatus = LineStatus.NoLine;
        let observedBits = 0;
        let selectedStart = -1;
        let selectedEnd = -1;
        if (starts.length > 0) {
            let chosen = branchPreference == BranchPreference.Left ? 0 : starts.length - 1;
            selectedStart = starts[chosen];
            selectedEnd = ends[chosen];
            if (starts.length > 1) {
                observedBits |= LineStatus.Junction;
                // All other line-colour components are rejected branches.
                for (let ch = 0; ch < 8; ch++) {
                    if (mask[ch] != 0 && (ch < selectedStart || ch > selectedEnd)) {
                        lineData[ch] = LineData.Junction;
                        observedBits |= ch < selectedStart ? LineStatus.JunctionLeft : LineStatus.JuntionRight;
                    }
                }
                // Include the chosen arm in the observed geometry as well.
                for (let i = 0; i < starts.length; i++) {
                    if ((starts[i] + ends[i]) / 2 < previousTrackCentre - 0.5) observedBits |= LineStatus.JunctionLeft;
                    if ((starts[i] + ends[i]) / 2 > previousTrackCentre + 0.5) observedBits |= LineStatus.JuntionRight;
                }
            } else {
                let width = selectedEnd - selectedStart + 1;
                let wide = width >= 6 || (mainTrackSeen && width >= Math.ceil(expectedWidth) + 2);
                if (wide) {
                    observedBits |= LineStatus.Junction;
                    if (selectedStart < previousTrackCentre - expectedWidth / 2) observedBits |= LineStatus.JunctionLeft;
                    if (selectedEnd > previousTrackCentre + expectedWidth / 2) observedBits |= LineStatus.JuntionRight;
                    if (width >= 6) observedBits |= LineStatus.Cross;
                    // On a joined Y or T, choose the edge corresponding to preference.
                    let keep = Math.max(1, Math.min(3, Math.round(expectedWidth)));
                    let oldStart = selectedStart;
                    let oldEnd = selectedEnd;
                    if (branchPreference == BranchPreference.Left) selectedEnd = Math.min(oldEnd, oldStart + keep - 1);
                    else selectedStart = Math.max(oldStart, oldEnd - keep + 1);
                    for (let ch = oldStart; ch <= oldEnd; ch++) {
                        if (ch < selectedStart || ch > selectedEnd) lineData[ch] = LineData.Junction;
                    }
                }
            }
            for (let ch = selectedStart; ch <= selectedEnd; ch++) lineData[ch] = LineData.Line;
            lineStatus = LineStatus.LineFound;
        }

        // Mark other-colour deviations in background pixels. They are observations,
        // never steering targets while following the selected line colour.
        if (referenceReady && selectedStart >= 0) {
            let contrast = Math.abs(learnedLine - learnedBackground);
            let tolerance = Math.max(minContrast, 0.35 * contrast);
            // Require a pair to reject isolated noisy pixels.
            for (let ch = 0; ch < 7; ch++) {
                if (mask[ch] == 0 && mask[ch + 1] == 0 &&
                    Math.abs(raw[ch] - learnedBackground) > tolerance &&
                    Math.abs(raw[ch + 1] - learnedBackground) > tolerance &&
                    (raw[ch] - learnedBackground) * (raw[ch + 1] - learnedBackground) > 0) {
                    let left = ch + 0.5 < (selectedStart + selectedEnd) / 2;
                    let lighter = (raw[ch] + raw[ch + 1]) / 2 > learnedBackground;
                    observedBits |= LineStatus.Junction;
                    observedBits |= left ? LineStatus.JunctionLeft : LineStatus.JuntionRight;
                    observedBits |= lighter ?
                        (left ? LineStatus.WhiteJunctionLeft : LineStatus.WhiteJunctionRight) :
                        (left ? LineStatus.BlackJunctionLeft : LineStatus.BlackJunctionRight);
                    lineData[ch] = LineData.Junction;
                    lineData[ch + 1] = LineData.Junction;
                }
            }
        } else if (referenceReady && selectedStart < 0) {
            // A uniform change is ambiguous: expose it, without inventing a line.
            let deviation = mean - learnedBackground;
            if (maximum - minimum < Math.max(minContrast, Math.abs(learnedLine - learnedBackground) * 0.35) &&
                Math.abs(deviation) > Math.max(minContrast, Math.abs(learnedLine - learnedBackground) * 0.35)) {
                lineStatus |= LineStatus.BackgroundChanged;
                // Observation only: another-colour crossing and a floor patch
                // are indistinguishable from this one-dimensional measurement.
                observedBits |= LineStatus.Cross | LineStatus.Junction;
                observedBits |= deviation > 0 ? LineStatus.WhiteLineCrossing : LineStatus.BlackLineCrossing;
                for (let ch = 0; ch < 8; ch++) lineData[ch] = LineData.Junction;
            }
        }

        if (selectedStart >= 0) {
            linePos = calcWeigthedLinePos(weights, lineData);
            previousTrackCentre = (selectedStart + selectedEnd) / 2;
        }
        updateEvent(observedBits);
        updateLineConditions((lineStatus & LineStatus.LineFound) != 0,
            (lineStatus & LineStatus.LineFound) != 0 && observedBits == 0 && !eventActive);

        // Learn ONLY from an ordinary, narrow, unambiguous line frame. Freeze
        // learning through crossings, branches, loss, and their release hysteresis.
        if (starts.length == 1 && count >= 1 && count <= 4 && observedBits == 0 && !eventActive) {
            let sumLine = 0;
            let sumBackground = 0;
            for (let ch = 0; ch < 8; ch++) {
                if (mask[ch]) sumLine += raw[ch];
                else sumBackground += raw[ch];
            }
            let newLine = sumLine / count;
            let newBackground = sumBackground / (8 - count);
            if (Math.abs(newLine - newBackground) >= minContrast) {
                let alpha = referenceReady ? dt / (referenceTimeS + dt) : 1;
                learnedLine += alpha * (newLine - learnedLine);
                learnedBackground += alpha * (newBackground - learnedBackground);
                haveLineReference = true;
                haveBackgroundReference = true;
                referenceReady = true;
                expectedWidth += alpha * (count - expectedWidth);
                mainTrackSeen = true;
            }
        }
    }

    // Compatibility: initialization starts continuous acquisition. Never launch
    // another acquisition from a user's polling loop.
    //% advanced=true blockId="linesensor8Pixel_sample" block="Start sensoren (kompatibilitet)"
    export function sample(): void { initLinesensor8Pixel(); }

    function acquireSample(): void {
        if (samplingBusy) return;
        samplingBusy = true;
        let started = input.runningTime();
        let depth = LowPassDepth;
        let ambient = [0, 0, 0, 0, 0, 0, 0, 0];
        let illuminated = [0, 0, 0, 0, 0, 0, 0, 0];
        setIRLedCurrent(0);
        for (let n = 0; n < depth; n++) {
            // Reverse physical channels once: logical index 0 = robot-left.
            for (let ch = 0; ch < 8; ch++) ambient[ch] += adcRead(8 - ch);
            setIRLedCurrent(90);
            for (let ch = 0; ch < 8; ch++) illuminated[ch] += adcRead(8 - ch);
            setIRLedCurrent(0);
        }
        for (let ch = 0; ch < 8; ch++) rawSignal[ch] = Math.max(0, illuminated[ch] - ambient[ch]) / depth;
        let completed = input.runningTime();
        let dt = lastSampleTime < 0 ? 0.01 : Math.max(0.001, (completed - lastSampleTime) / 1000);
        processLine(rawSignal, dt);
        let visible = (lineStatus & LineStatus.LineFound) != 0;
        if (visible && !lineWasVisible) lineFoundCount++;
        lineWasVisible = visible;
        updateStatusLeds(lineData);
        completed = input.runningTime();
        lastSampleIntervalMs = lastSampleTime < 0 ? 0 : completed - lastSampleTime;
        maxSampleIntervalMs = Math.max(maxSampleIntervalMs, lastSampleIntervalMs);
        lastSampleDurationMs = completed - started;
        lastSampleTime = completed;
        samplingBusy = false;
    }

    function startSamplingLoop(): void {
        if (samplingLoopStarted) return;
        samplingLoopStarted = true;
        control.inBackground(function () {
            while (true) {
                let started = input.runningTime();
                acquireSample();
                basic.pause(Math.max(1, requestedPeriodMs - (input.runningTime() - started)));
            }
        });
    }

    // Sensor acquisition always runs after initialization; only the requested
    // period changes. It includes acquisition time and is not a hard deadline.
    //% blockId="linesensor8Pixel_period"
    //% block="Indstil måleinterval til $periodMs ms"
    //% periodMs.defl=10 periodMs.min=1
    export function setSamplingPeriod(periodMs: number): void {
        requestedPeriodMs = Math.max(1, Math.round(periodMs));
    }

    // Compatibility with the preceding automatic-sampling API.
    //% advanced=true blockId="linesensor8Pixel_startSampling"
    //% block="Start sensor med måleinterval $periodMs ms"
    //% periodMs.defl=10 periodMs.min=1
    export function startAutomaticSampling(periodMs: number = 10): void {
        setSamplingPeriod(periodMs);
        initLinesensor8Pixel();
    }
    export function isAutomaticSampling(): boolean {
        return sensorInitialized && samplingLoopStarted;
    }
    //% advanced=true blockId="linesensor8Pixel_ready" block="sensor initialiseret?"
    export function isInitialized(): boolean { return sensorInitialized; }
    //% advanced=true blockId="linesensor8Pixel_age" block="målingens alder ms"
    export function getSampleAgeMs(): number {
        return lastSampleTime < 0 ? 2147483647 : input.runningTime() - lastSampleTime;
    }
    //% advanced=true blockId="linesensor8Pixel_duration" block="målingens varighed ms"
    export function getSampleDurationMs(): number { return lastSampleDurationMs; }
    //% advanced=true blockId="linesensor8Pixel_interval" block="måleinterval ms"
    export function getSampleIntervalMs(): number { return lastSampleIntervalMs; }
    //% advanced=true blockId="linesensor8Pixel_maxInterval" block="største måleinterval ms"
    export function getMaxSampleIntervalMs(): number { return maxSampleIntervalMs; }

    // Count transitions into line visibility, retaining even a short observation.
    //% blockId="linesensor8Pixel_lineFoundCount" block="antal nye linjefund"
    export function getLineFoundCount(): number { return lineFoundCount; }
    //% blockId="linesensor8Pixel_resetLineFoundCount" block="Nulstil antal linjefund"
    export function resetLineFoundCount(): void { lineFoundCount = 0; }

    //% blockId="linesensor8Pixel_branchCount" block="antal sideudgreninger"
    export function getBranchCount(): number { return branchCount; }
    //% blockId="linesensor8Pixel_atBranch" block="sideudgrening fundet?"
    export function isAtBranch(): boolean {
        return eventActive && (activeBits & LineStatus.Cross) == 0;
    }
    //% blockId="linesensor8Pixel_atCrossing" block="kryds fundet?"
    export function isOnCrossing(): boolean {
        return eventActive && (activeBits & LineStatus.Cross) != 0;
    }
    //% blockId="linesensor8Pixel_lineLost" block="linjen mistet (bekræftet)?"
    export function isLineLostConfirmed(): boolean { return visibilityState == 2; }
    export function getLineLossCount(): number { return lineLossCount; }
    //% blockId="linesensor8Pixel_cleanLine" block="ren linje (bekræftet)?"
    export function isCleanLine(): boolean {
        return getSampleAgeMs() <= 100 && cleanlinessState == 1;
    }
    export function isNotCleanLineConfirmed(): boolean { return cleanlinessState == 2; }
    export function getNotCleanLineCount(): number { return uncleanCount; }

    //% blockId="linesensor8Pixel_junctionCount" block="antal udgreninger eller kryds"
    export function getJunctionCount(): number { return junctionCount; }
    //% blockId="linesensor8Pixel_crossingCount" block="antal kryds"
    export function getCrossingCount(): number { return crossingCount; }
    //% blockId="linesensor8Pixel_resetCounts" block="Nulstil udgrenings- og krydstællere"
    export function resetDetectionCounts(): void {
        junctionCount = 0;
        branchCount = 0;
        crossingCount = 0;
        lineLossCount = 0;
        uncleanCount = 0;
    }
    //% blockId="linesensor8Pixel_atJunction" block="udgrening eller kryds fundet?"
    export function isAtJunction(): boolean { return eventActive; }
    export function isJunctionCandidate(): boolean { return eventCandidateSamples > 0 || eventActive; }
    //% blockId="linesensor8Pixel_backgroundChanged" block="baggrunden ændret?"
    export function backgroundChanged(): boolean { return (lineStatus & LineStatus.BackgroundChanged) != 0; }
    //% advanced=true blockId="linesensor8Pixel_referenceReady" block="linje og baggrund indlært?"
    export function referenceEstablished(): boolean { return referenceReady; }
    //% advanced=true blockId="linesensor8Pixel_resetReference" block="Nulstil indlært linje og baggrund"
    export function resetReference(): void { resetTracking(); }

    // Optional startup calibration; covers ALL pixels with one material.
    //% advanced=true blockId="linesensor8Pixel_captureSurface"
    //% block="Kalibrer hele sensoren på $surface"
    export function calibrateSurface(surface: LineData): boolean {
        if (getSampleAgeMs() > 100 || surface == LineData.Junction) return false;
        let mean = 0;
        for (let ch = 0; ch < 8; ch++) mean += rawSignal[ch];
        mean /= 8;
        if (surface == LineData.Background) {
            learnedBackground = mean;
            haveBackgroundReference = true;
        } else {
            learnedLine = mean;
            haveLineReference = true;
        }
        referenceReady = haveBackgroundReference && haveLineReference &&
            Math.abs(learnedLine - learnedBackground) >= Math.max(1, MinContrast / LowPassDepth);
        return true;
    }
}
