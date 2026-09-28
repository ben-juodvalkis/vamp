# ADR 073: Build Performance Optimization

**Status**: Accepted and Implemented
**Date**: 2025-10-25
**Deciders**: Development Team
**Related**: vite.config.ts, svelte.config.js

---

## Context

The SvelteKit build process was experiencing severe performance issues with build times exceeding 50+ seconds, significantly impacting development iteration speed. Investigation revealed that the build system was scanning and processing over 47,000 audio files (30,687 .wav/.aif/.aiff files and 2,695 .adg device files) during the build process.

### Performance Issues Identified

1. **Vite File Scanning**: The development server was watching and analyzing 47,955 preset files in `./ableton/Presets/`
2. **Adapter-node Compression**: The `@sveltejs/adapter-node` was pre-compressing thousands of files during build
3. **Build Time**: Total build time was ~60+ seconds, with adapter-node step taking ~50 seconds

### Impact on Development

- Slow feedback loops during development
- Reduced productivity when testing changes
- Particularly problematic for the iPad setup workflow (`npm run ipad`)

## Decision

We will optimize the build process by excluding audio files from Vite processing while preserving all application functionality.

### Solution Components

1. **Vite Configuration Optimization**:
   - Add `server.watch.ignored` patterns to exclude audio directories from file watching
   - Add `build.rollupOptions.external` function to exclude audio files from dependency analysis

2. **Adapter-node Optimization**:
   - Set `precompress: false` to disable gzip/brotli pre-compression during build
   - This trades build time for slightly slower initial page loads

3. **Preserve Preset Functionality**:
   - Keep existing preset scanning scripts intact
   - Generated JSON files still provide full preset access to the application

## Implementation

### Vite Configuration (`interface/vite.config.ts`)

```typescript
export default defineConfig({
  server: {
    // ... existing config
    watch: {
      // Exclude large audio/preset directories from file watching
      ignored: [
        '../ableton/Presets/**',
        '../scripts/device-creation/templates/**',
        '../Samples/**',
        '../temp/**',
        '../docs-archive/**',
        '**/*.wav',
        '**/*.aif',
        '**/*.aiff',
        '**/*.flac',
        '**/*.mp3'
      ]
    }
  },
  // ... other config
  build: {
    rollupOptions: {
      // Exclude audio files from dependency analysis during build
      external: (id) => {
        return id.includes('.wav') || 
               id.includes('.aif') || 
               id.includes('.aiff') || 
               id.includes('.flac') || 
               id.includes('.mp3') ||
               id.includes('/ableton/Presets/') ||
               id.includes('/scripts/device-creation/templates/');
      }
    }
  }
});
```

### Adapter Configuration (`interface/svelte.config.js`)

```javascript
kit: {
  adapter: adapter({
    out: 'build',
    precompress: false,  // Disable compression to speed up build
    envPrefix: '',
    polyfill: true
  })
}
```

## Consequences

### Positive

- **Build Performance**: ~75% improvement (60+ seconds → ~16 seconds)
- **Development Velocity**: Faster iteration cycles for developers
- **Preserved Functionality**: All preset access and application features remain intact
- **Script Independence**: Preset scanning scripts continue to work normally

### Trade-offs

- **Initial Page Load**: Slightly slower due to on-the-fly compression instead of pre-compressed assets
- **Development vs Production**: May want to re-enable `precompress: true` for production deployments

### Neutral

- **File Structure**: No changes to existing preset organization
- **Generated Files**: JSON preset indexes still created and used normally
- **Application Logic**: No code changes required in components

## Monitoring

- Build times should consistently stay under 20 seconds
- Preset functionality should remain fully operational
- Consider re-enabling precompression for production builds if serving performance becomes an issue

## Alternative Considered

**Moving Audio Files**: Considered relocating preset files outside the project directory, but rejected due to:
- Complex path dependencies in existing scripts
- Risk of breaking preset scanning functionality
- Maintenance overhead of managing external file locations

The chosen solution provides maximum performance benefit with minimal risk and no functional changes.