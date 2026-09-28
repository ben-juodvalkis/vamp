# Live Looping Interface

A professional live looping system for Ableton Live with touch-optimized iPad control, real-time parameter sync, and integrated preset browsing.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Ableton Live](https://img.shields.io/badge/Ableton%20Live-11%20%7C%2012-orange.svg)](https://www.ableton.com/)

---

## ✨ Features

- **Touch-Optimized Interface** - iPad-friendly controls for live performance
- **Real-Time Bidirectional Sync** - Changes in Ableton instantly reflect in the interface and vice versa
- **Integrated Preset Browsers** - Browse and load Ableton, Omnisphere, and Native Instruments presets
- **Direct USB-C Connection** - Reliable, low-latency iPad connectivity
- **Clip & Scene Management** - Launch clips and scenes from your iPad
- **Track Parameter Control** - Full control over device parameters, sends, and track properties
- **Production Ready** - Optimized performance mode for live use

---

## 🎯 Quick Links

- **[Installation Guide](INSTALLATION.md)** - Step-by-step setup instructions
- **[FAQ](documentation/FAQ.md)** - Common questions and answers
- **[Troubleshooting](documentation/TROUBLESHOOTING.md)** - Debug common issues
- **[Contributing](CONTRIBUTING.md)** - How to contribute to the project

---

## ⚠️ Important: Setup Required

**This is not a plug-and-play application.** You must configure paths specific to your system before use.

**Time required:** 15-30 minutes
**Difficulty:** Beginner to Intermediate (requires basic terminal knowledge)

### What's Included

✅ Complete looping interface application
✅ OSC bridge and communication layer
✅ Configuration templates
✅ Comprehensive documentation

### What You Provide

❌ Ableton Live (you install this separately)
❌ Your preset files (Ableton instruments, Omnisphere, NI, etc.)
❌ Configuration (paths to your files and applications)

---

## 📋 System Requirements

### Required

- **macOS** 12.0 (Monterey) or later
- **Node.js** 18.0 or later ([download](https://nodejs.org/))
- **Ableton Live** 11 or 12 (Suite recommended)

### Optional

- **iPad** with USB-C or WiFi for touch interface
- **Omnisphere** 2/3 for synth preset browsing
- **Native Instruments Komplete** for NI preset browsing

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm run setup

# 2. Your own settings, if any: config/constants.local.json, laid over the
# tracked defaults (INSTALLATION.md, Step 4)

# 3. Validate configuration
npm run validate

# 4. Run development server
npm run dev
```

**Need help?** See the [Installation Guide](INSTALLATION.md) for detailed step-by-step instructions.

---

## 💻 Usage

### Development Mode

Start the full development environment with all services:

```bash
npm run dev
```

**Access URLs:**
- **Mac**: `http://localhost:3000`
- **iPad**: `http://hostname.local:3000` (via USB-C or WiFi)

**Services Started:**
- SvelteKit development server (port 3000)
- OSC Bridge (WebSocket ↔ Max4Live)
- All preset browser servers
- Automatic Ableton Live launch

### Production iPad Setup
Optimized setup for live performance:

```bash
npm run ipad
```

**Features:**
- Production-optimized interface build
- Automatic network interface detection
- Clear URL reporting for iPad access
- Essential services only (OSC bridge + interface)
- Browser components initialize automatically

**Access URLs:**
- **WiFi**: `http://192.168.x.x:8889`
- **USB-C**: `http://169.254.x.x:8889`
- **Mac**: `http://localhost:8889`

## 📱 iPad Connection

### USB-C Connection (Recommended)
1. Connect iPad to Mac via USB-C cable
2. Run `npm run ipad`
3. Access via displayed network interface URLs
4. No network configuration required

### WiFi Connection
1. Ensure iPad and Mac on same WiFi network
2. Run `npm run ipad`
3. Use displayed WiFi IP address
4. Configure iPad network settings if needed

## 🏗️ Architecture

The system consists of three main components:

1. **SvelteKit Interface** - Modern iPad touch interface for live performance control
2. **Max4Live Device** - Direct API bridge connecting interface to Ableton Live
3. **OSC Bridge** - WebSocket ↔ UDP translation layer

### Key Features
- **Real-time parameter control** with bidirectional sync
- **Integrated browser components** for Omnisphere, Native Instruments, and Ableton patches
- **Direct USB-C networking** for reliable iPad connection
- **Production-optimized builds** for live performance
- **Svelte 5 + Tailwind** modern responsive interface

## 📁 Project Structure

```
├── interface/         # SvelteKit touch interface with WebSocket-OSC communication
│   └── bridge/        # OSC bridge (WebSocket ↔ UDP)
├── surface/           # The Python control surface Live runs as "Vamp"
├── Vamp Devices/      # The Max for Live devices the app loads: add this folder as a Place in Live
├── owner/             # The owner's rig only, off by default (AX helper, menubar app, Max patch, probes)
├── config/            # Project-wide configuration (constants.json)
├── scripts/           # Setup, build, gate and screenshot scripts
└── docs/              # reference/, plans/ and adr/
```

## 🛠️ Additional Commands

```bash
# Install all dependencies
npm run setup

# Check network interfaces and URLs
npm run interfaces

# Build production interface only
npm run build

# Start individual services
npm run bridge     # OSC bridge only
npm run interface  # SvelteKit interface only
```

## 📖 Documentation

### New Users

- **[Installation Guide](INSTALLATION.md)** ⭐ **Start here** - Step-by-step setup
- **[FAQ](documentation/FAQ.md)** - Frequently asked questions
- **[Troubleshooting](documentation/TROUBLESHOOTING.md)** - Common issues and solutions
- **[iPad Quickstart](documentation/ipad-quickstart.md)** - iPad connection guide

### Developers & Contributors

- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute
- **[Development Setup](CLAUDE.md)** - Developer guidelines and project structure
- **[Architecture Overview](documentation/v6-architecture-overview.md)** - System architecture
- **[API Reference](documentation/v6-api.md)** - Complete API documentation
- **[UI Architecture](documentation/v6-ui-architecture.md)** - Interface component details

## 🎯 Live Performance Workflow

1. **Setup**: Run `npm run ipad` for production setup
2. **Connect**: iPad via USB-C or WiFi using displayed URLs
3. **Load**: Launch Ableton Live and load Max4Live device
4. **Control**: Full bidirectional control between iPad interface and Live

The interface provides real-time parameter control, clip management, track control, and integrated patch browsing - optimized for live performance scenarios.

## 🔧 Tech Stack

- **Frontend**: SvelteKit + Svelte 5 (with runes)
- **Styling**: Tailwind CSS 4 + shadcn-svelte
- **Communication**: WebSocket + OSC (Open Sound Control)
- **Ableton Integration**: AbletonOSC V6 / Max4Live
- **Languages**: TypeScript, JavaScript, Python

---

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) first.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit your changes (`git commit -m 'feat: add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Ableton Live** - The amazing DAW that powers this system
- **AbletonOSC** - Python OSC server for Ableton Live control
- **Svelte** - Reactive UI framework
- **shadcn-svelte** - Beautiful component library

---

## 📬 Support

- **Issues**: Report bugs using [GitHub Issues](https://github.com/ben-juodvalkis/Looping/issues)
- **Discussions**: Ask questions in [GitHub Discussions](https://github.com/ben-juodvalkis/Looping/discussions)
- **Documentation**: Check the [FAQ](documentation/FAQ.md) first

---

## 🎵 Happy Looping!

Built with ❤️ for live performers who want seamless control of Ableton Live.