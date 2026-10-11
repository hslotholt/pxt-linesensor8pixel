# Robot I2C MakeCode extension

For micro:bit MakeCode TypeScript / blocks.

Addresses: TCA9534 0x20 and 0x21; ADS7828 0x48; MCP47FEB02A0 0x60.

## Installation
Create a GitHub repository with `pxt.json` and `main.ts` at the root, then in MakeCode choose Extensions and paste its GitHub URL. For initial experiments you can paste `main.ts` into a new MakeCode project, but a GitHub repository is required for normal extension installation.

## Examples
```typescript
robotI2C.tcaDirectionMask(robotI2C.Expander.First, 0xF0)
robotI2C.tcaWritePin(robotI2C.Expander.First, 0, true)
let inputs = robotI2C.tcaReadPort(robotI2C.Expander.Second)
let raw = robotI2C.adsRead(0, robotI2C.AdcReference.Internal)
robotI2C.dacWrite(robotI2C.DacChannel.DAC0, 225)
```

## Notes
- TCA9534: 1=input, 0=output in configuration mask. Inputs need suitable external biasing; the TCA9534 does not provide programmable pull-ups.
- ADS7828: `adsRead()` returns 0..4095. `adsReadMillivolts()` assumes internal reference and takes the reference voltage in mV (nominal 2500). Do not use it for an external reference without adapting the function.
- MCP47FEB02: volatile DAC writes only, no EEPROM wear. DAC reference/gain configuration must already match your circuit (internal reference, 2x gain for ~2.44 V full scale). Check this on first power-up. LAT/HVC should be low as planned.
- Hardware I2C requires SDA/SCL pull-ups and shared ground.
- Hardware has not been tested; validate on the board before relying on the output.
