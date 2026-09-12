# Modular Multi-Phone Tabletop

Phones (and the laptop) are windows into one shared world. Layout is an integer grid. UWB ranging is iPhone 11+ only and needs two phones.

## Test tonight with one iPhone (no UWB)

Skip the Xcode app. This checks rooms, viewports, and the walking token.

1. Same Wi‑Fi. On the laptop: `npm install && npm run dev`
2. Open the URL Vite prints (laptop). Click **Create room**. Leave this tab open.
3. On the iPhone, Safari the LAN URL from the terminal (`http://YOUR_LAN_IP:5173`) or scan the QR on the laptop HUD.
4. You should see two different biomes/cells. Tap the screen edges — the token should cross from laptop to phone.

That is the whole one-phone test. Nearby Interaction cannot range a phone against itself.

## UWB later (two iPhone 11+)

Open `ios/NearbyTable/NearbyTable.xcodeproj`, set your Team, install on both phones. Enter the laptop IP, join the same room, tap who is on the origin phone’s right, Calibrate Gx. Grid math lives in `server/gridSnap.mjs`.
