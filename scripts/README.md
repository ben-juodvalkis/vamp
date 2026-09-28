# Automation Scripts

Development and content automation scripts for the Live Looping System.

## Available Scripts

### The Places catalog (`generate-places-catalog.ts`, `places-diff.ts`)
Since 2026-09-26 the interface server builds the browser's catalog at runtime
for the Places ticked in Settings and serves it over `/api/places/*`. The
script warms that cache by hand (`npm run generate-places`), and
`npm run places:diff` compares a catalog built from Live's index with one
built from the disk. See `scripts/CLAUDE.md` for the details.

### iPad Setup (`setup-ipad.js`)
Configure iPad USB-C network connection:
- **Network Configuration**: Set up USB-C networking
- **IP Assignment**: Configure static IP addresses
- **Automatic Setup**: Run on dev server startup

## Integration Overview

These scripts generate configuration and catalog data for the Live Looping interface:

1. **Scan** the Places
2. **Generate** JSON catalogs for the UI
3. **Configure** network and device settings
4. **Access** through the drill-down browser in the SvelteKit interface

## Usage Examples

```bash
# Warm the Places catalog by hand (the server builds it itself)
npm run generate-places

# Start everything for the iPad
npm run ipad
```

## Architecture Integration

All scripts are designed to integrate seamlessly with the Live Looping System:
- **Output Compatibility**: Generated content works with the GestureBrowser
- **Naming Conventions**: Follows project standards
- **Error Handling**: Robust processing with detailed logging
- **Performance**: Optimized for large-scale scanning operations
