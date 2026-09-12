# Tabletop

Phones are windows on one shared meadow. **UWB** (the Find My / AirTag radio, via Nearby Interaction) measures distance between iPhones. The **IMU** detects pickup and which way you carried the phone. The server snaps that onto a unique N/S/E/W cell — and that cell is a new tile of the map.

Laptop is a spectator. Players only exist in the native iOS app. Safari cannot run Nearby Interaction, and one phone cannot range itself.

## Laptop

Same Wi‑Fi as the phones.

```bash
npm install
npm run dev
```

That starts Vite on **5173** and the snap server on **8787** (`/ws` is proxied). Open the Vite URL, click **Create a room**, leave the tab open, and note the four-letter code.

Optional: enter a code and **Watch this table** to reopen a spectator board. Grid math lives in `server/gridSnap.mjs`. Tests: `npm run test:grid`.

## Phones

Need **two iPhone 11 or newer** (U1/U2). Open `ios/NearbyTable/NearbyTable.xcodeproj`, set your Team, install on both.

On each phone:

1. Laptop LAN IP (Vite prints it, e.g. `172.x.x.x`)
2. Your name
3. Room code
4. **Join room**

Keep screen tops pointing the same way. After two phones join, axis and Gx come from live UWB — no calibrate overlay.

## Play

Pick a phone up, set it down in a new seat. That phone’s screen is that cell. Tap sheep, wheat, clay, or stone to collect. Tap the pack to trade. First player with **at least one of each** wins.

## Why native

UWB ranging uses Apple **Nearby Interaction**. The game UI is still the web app, loaded in a WKWebView; ranging and IMU stay in Swift.
