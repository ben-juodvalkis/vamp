# Instrument Rack

`InstrumentGroupDevice` ("Instrument Rack"), Python `RackDevice`. Measured on the rig with `owner/probes/device_dump.js`, 2026-10-27: inserted, empty. Raw dump: [`dumps/Instrument_Rack.json`](dumps/Instrument_Rack.json).

## Parameters (18)

Index is the LOM index **for this state of the device**: see the README on lists that change with sections. Values are Live's raw units; labels are Live's own text (`str_for_value`).

| # | Name | Range | Default | Q | Labels |
|---|---|---|---|---|---|
| 0 | Device On | 0..1 |  | q | 0=Off · 1=On |
| 1 | Macro 1 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 2 | Macro 2 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 3 | Macro 3 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 4 | Macro 4 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 5 | Macro 5 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 6 | Macro 6 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 7 | Macro 7 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 8 | Macro 8 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 9 | Macro 9 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 10 | Macro 10 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 11 | Macro 11 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 12 | Macro 12 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 13 | Macro 13 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 14 | Macro 14 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 15 | Macro 15 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 16 | Macro 16 | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |
| 17 | Chain Selector | 0..127 | 0 |  | 0=0 · 31.75=31 · 63.5=63 · 95.25=95 · 127=127 |

## Other attributes (31)

S = settable, L = Live offers a listener.

| Attribute | S | L | Value | Live's doc |
|---|---|---|---|---|
| `can_compare_ab` |  |  | False | Returns true if the Device has the capability to AB compare. |
| `can_have_chains` |  |  | True | Returns true if the device is a rack. |
| `can_have_drum_pads` |  |  | False | Returns true if the device is a drum rack. |
| `can_show_chains` |  |  | False | return True, if this Rack contains a rack instrument device that is capable of showing its chains in session view. |
| `chain_selector` |  |  | <DeviceParameter.DeviceParameter object at 0x134190940> | Const access to the chain selector parameter. |
| `chain_selector.automation_state` |  | L | 0 | Returns state of type AutomationState. |
| `chain_selector.default_value` |  |  | 0 | Return the default value for this parameter.  A Default value is only |
| `chain_selector.display_value` | S | L | 0 | Get/Set the current value (as visible in the GUI) this parameter. |
| `chain_selector.is_enabled` |  |  | True | Returns false if the parameter has been macro mapped or disabled by Max. |
| `chain_selector.is_quantized` |  |  | False | Returns True, if this value is a boolean or integer like switch. |
| `chain_selector.max` |  |  | 127 | Returns const access to the upper value of the allowed range for |
| `chain_selector.min` |  |  | 0 | Returns const access to the lower value of the allowed range for |
| `chain_selector.name` |  | L | Chain Selector | Returns const access the name of this parameter, as visible in Lives |
| `chain_selector.original_name` |  |  | Chain Selector | Returns const access the original name of this parameter, unaffected of |
| `chain_selector.state` |  | L | 0 | Returns the state of the parameter: |
| `chain_selector.value` | S | L | 0 | Get/Set the current internal value of this parameter. |
| `chains` |  | L | <Base.Vector object at 0x134190940> | Return const access to the list of chains in this device. Throws an exception if can_have_chains is false. |
| `class_display_name` |  |  | Instrument Rack | Return const access to the name of the device's class name as displayed in Live's browser and device chain |
| `class_name` |  |  | InstrumentGroupDevice | Return const access to the name of the device's class. |
| `has_macro_mappings` |  | L | False | Returns true if any of the rack's macros are mapped to a parameter. |
| `is_active` |  | L | True | Return const access to whether this device is active. This will be false bothwhen the device is off and when it's inside a rack device which is off. |
| `is_showing_chains` | S | L | False | Returns True, if it is showing chains. |
| `latency_in_ms` |  | L | 0 | Returns the latency of the device in ms. |
| `latency_in_samples` |  | L | 0 | Returns the latency of the device in samples. |
| `macros_mapped` |  | L | [False, False, False, False, False, False, False, False, … | A list of booleans, one for each macro parameter, which is True iffthat macro is mapped to something |
| `name` | S | L | Instrument Rack | Return access to the name of the device. |
| `return_chains` |  | L | <Base.Vector object at 0x134190940> | Return const access to the list of return chains in this device. Throws an exception if can_have_chains is false. |
| `selected_variation_index` | S |  | -1 | Access to the index of the currently selected macro variation.Throws an exception if the index is out of range. |
| `type` |  |  | Device.DeviceType.instrument | Return the type of the device. |
| `variation_count` |  | L | 0 | Access to the number of macro variations currently stored. |
| `visible_macro_count` |  | L | 8 | Access to the number of macros that are currently visible. |
