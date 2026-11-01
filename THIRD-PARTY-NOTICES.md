# Third-party notices

Vamp's own code is under the MIT license in [LICENSE](LICENSE). Its npm dependencies carry their
own licenses in `node_modules`. The code below was copied into this repository and is used under
its authors' terms.

## Inside Vamp for Mac

The installed app (installer.plan.md) carries two things that are not Vamp's own code, each with
its license beside it in the app:

- **Node.js**, the official macOS release, in `Contents/Resources/node/` with its `LICENSE` (MIT,
  and the licenses of what Node itself includes).
- **The npm packages bundled into the server**, in `Contents/Resources/vamp/THIRD-PARTY-LICENSES.md`,
  which `scripts/build-server.mjs` writes from every package the bundles take in. `osc` and `slip`
  are offered under MIT or GPL; Vamp uses them under MIT.

## shadcn-svelte

The UI components in `interface/src/lib/components/ui/` started from
[shadcn-svelte](https://github.com/huntabyte/shadcn-svelte).

```
MIT License

Copyright (c) 2023 Hunter Johnston <https://github.com/huntabyte>
Copyright (c) 2023 CokaKoala <https://github.com/adriangonz97>
Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
