import CoreMotion
import SwiftUI
import WebKit

struct RootView: View {
  @StateObject private var socket: RoomSocket
  @StateObject private var ranging = NearbyRanging()
  @StateObject private var lift = LiftMonitor()
  @AppStorage("laptopIP") private var laptopIP = ""
  @AppStorage("roomCode") private var roomCode = ""
  @AppStorage("playerName") private var playerName = ""
  @State private var playing = false

  private let deviceId: String

  init() {
    let id = Self.loadDeviceId()
    _socket = StateObject(wrappedValue: RoomSocket(deviceId: id))
    deviceId = id
  }

  var body: some View {
    ZStack {
      Color(red: 12 / 255, green: 10 / 255, blue: 8 / 255).ignoresSafeArea()
      if playing {
        if socket.devices[deviceId] != nil {
          PlayChrome(socket: socket, ranging: ranging, gameURL: gameURL, deviceId: deviceId)
        } else {
          splashShell {
            ProgressView()
              .tint(Color(red: 244 / 255, green: 211 / 255, blue: 94 / 255))
            Text("Joining \(roomCode.uppercased())…")
              .font(.title3.weight(.semibold))
            if let error = socket.error {
              Text(error).foregroundStyle(Color(red: 0.85, green: 0.35, blue: 0.28))
            }
            Button("Cancel") { playing = false }
              .foregroundStyle(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255))
          }
        }
      } else {
        ScrollView {
          splashShell { setupFields }
            .padding(.vertical, 36)
        }
      }
    }
  }

  private func splashShell<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(spacing: 18) {
      HStack(spacing: 10) {
        ForEach(["🐑", "🌾", "🧱", "🪨"], id: \.self) { glyph in
          Text(glyph)
            .font(.title)
            .frame(width: 58, height: 58)
            .background(Color(red: 244 / 255, green: 211 / 255, blue: 94 / 255).opacity(0.14))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
      Text("HACKCMU")
        .font(.caption.weight(.semibold))
        .tracking(3)
        .foregroundStyle(Color(red: 215 / 255, green: 177 / 255, blue: 92 / 255))
      Text("Tabletop")
        .font(.system(size: 42, weight: .bold, design: .rounded))
        .foregroundStyle(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255))
      Text("Gather sheep, wheat, clay, and stone.\nFirst to hold all four wins.")
        .multilineTextAlignment(.center)
        .foregroundStyle(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255).opacity(0.72))
        .padding(.bottom, 6)
      content()
    }
    .padding(24)
    .frame(maxWidth: 440)
    .background(
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .fill(Color(red: 26 / 255, green: 20 / 255, blue: 12 / 255).opacity(0.92))
        .overlay(
          RoundedRectangle(cornerRadius: 28, style: .continuous)
            .stroke(Color(red: 244 / 255, green: 211 / 255, blue: 94 / 255).opacity(0.22))
        )
    )
    .padding()
  }

  private var setupFields: some View {
    VStack(spacing: 12) {
      splashField("Laptop on Wi‑Fi", text: $laptopIP, keyboard: .numbersAndPunctuation, caps: .never)
      splashField("Your name", text: $playerName, keyboard: .default, caps: .words)
      splashField("Room code", text: $roomCode, keyboard: .asciiCapable, caps: .characters)
      if let error = socket.error {
        Text(error)
          .font(.footnote)
          .foregroundStyle(Color(red: 0.85, green: 0.35, blue: 0.28))
      }
      Button(action: { start(create: true) }) {
        Text("Create a room")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .background(canStart ? Color(red: 244 / 255, green: 211 / 255, blue: 94 / 255) : Color.gray.opacity(0.35))
          .foregroundStyle(Color(red: 27 / 255, green: 20 / 255, blue: 8 / 255))
          .clipShape(Capsule())
      }
      .disabled(!canStart)
      Button(action: { start(create: false) }) {
        Text("Join room")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .overlay(Capsule().stroke(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255).opacity(0.28)))
          .foregroundStyle(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255))
      }
      .disabled(roomCode.count < 4 || !canStart)
    }
  }

  private func splashField(
    _ title: String,
    text: Binding<String>,
    keyboard: UIKeyboardType,
    caps: TextInputAutocapitalization
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title.uppercased())
        .font(.caption2.weight(.semibold))
        .tracking(1.4)
        .foregroundStyle(Color(red: 215 / 255, green: 177 / 255, blue: 92 / 255))
      TextField("", text: text)
        .keyboardType(keyboard)
        .textInputAutocapitalization(caps)
        .padding(12)
        .background(Color(red: 27 / 255, green: 23 / 255, blue: 18 / 255))
        .foregroundStyle(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color(red: 244 / 255, green: 232 / 255, blue: 193 / 255).opacity(0.2)))
    }
  }

  private var gameURL: URL {
    var bits = URLComponents()
    bits.scheme = "http"
    bits.host = laptopIP.trimmingCharacters(in: .whitespaces)
    bits.port = 5173
    bits.queryItems = [
      URLQueryItem(name: "room", value: roomCode.uppercased()),
      URLQueryItem(name: "device", value: deviceId),
      URLQueryItem(name: "name", value: playerName.trimmingCharacters(in: .whitespaces)),
    ]
    return bits.url!
  }

  private var wsURL: URL {
    var bits = URLComponents()
    bits.scheme = "ws"
    bits.host = laptopIP.trimmingCharacters(in: .whitespaces)
    bits.port = 8787
    bits.path = "/ws"
    return bits.url!
  }

  private var canStart: Bool {
    !laptopIP.trimmingCharacters(in: .whitespaces).isEmpty &&
      playerName.trimmingCharacters(in: .whitespaces).count >= 2
  }

  private func start(create: Bool) {
    let host = laptopIP.trimmingCharacters(in: .whitespaces)
    guard !host.isEmpty else { return }
    let code = roomCode.uppercased()
    roomCode = code
    if create && code.count < 4 {
      roomCode = Self.makeCode()
    }
    ranging.onToken = { token in
      socket.sendToken(token)
    }
    ranging.onDistance = { id, meters, dx, dy, dz in
      socket.sendRange(to: id, distance: meters, dx: dx, dy: dy, dz: dz)
    }
    socket.onReady = {
      ranging.republishToken()
      ranging.syncPeers(socket.tokens, myId: deviceId)
    }
    socket.connect(wsURL: wsURL, code: roomCode, create: create, name: playerName)
    ranging.start()
    ranging.republishToken()
    lift.start { lifted, carryX, carryY in
      socket.sendStatus(lifted ? "lifted" : "table", carryX: carryX, carryY: carryY)
    }
    playing = true
  }

  private static func loadDeviceId() -> String {
    let key = "tabletop-device-id"
    if let existing = UserDefaults.standard.string(forKey: key) { return existing }
    let id = UUID().uuidString
    UserDefaults.standard.set(id, forKey: key)
    return id
  }

  private static func makeCode() -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    return String((0..<4).map { _ in alphabet.randomElement()! })
  }
}

struct PlayChrome: View {
  @ObservedObject var socket: RoomSocket
  @ObservedObject var ranging: NearbyRanging
  let gameURL: URL
  let deviceId: String

  var body: some View {
    GameWebView(url: gameURL)
      .ignoresSafeArea()
      .onChange(of: socket.tokens) { _, tokens in
        ranging.syncPeers(tokens, myId: deviceId)
      }
      .onAppear {
        ranging.syncPeers(socket.tokens, myId: deviceId)
        ranging.republishToken()
      }
  }
}

struct GameWebView: UIViewRepresentable {
  let url: URL

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    let view = WKWebView(frame: .zero, configuration: config)
    view.scrollView.bounces = false
    view.load(URLRequest(url: url))
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {}
}

final class LiftMonitor: ObservableObject {
  @Published var lifted = false
  private let motion = CMMotionManager()
  private var highSince: TimeInterval?
  private var lowSince: TimeInterval?
  private var lastT: TimeInterval?
  private var vx = 0.0
  private var vy = 0.0
  private var px = 0.0
  private var py = 0.0
  private var liftXx = 1.0
  private var liftXy = 0.0
  private var liftYx = 0.0
  private var liftYy = 1.0

  func start(onChange: @escaping (Bool, Double, Double) -> Void) {
    guard motion.isDeviceMotionAvailable else { return }
    motion.deviceMotionUpdateInterval = 0.05
    motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: .main) { [weak self] data, _ in
      guard let self, let data else { return }
      let accel = data.userAcceleration
      let g = data.gravity
      let mag = (accel.x * accel.x + accel.y * accel.y + accel.z * accel.z).squareRoot()
      let flatness = abs(g.z)
      let now = Date().timeIntervalSince1970
      let pickingUp = mag > 0.22 || (mag > 0.10 && flatness < 0.94)
      let onTable = mag < 0.16 && flatness > 0.90
      if self.lifted {
        self.integrate(data)
      }
      if pickingUp {
        self.lowSince = nil
        if self.highSince == nil { self.highSince = now }
        if !self.lifted, now - (self.highSince ?? now) > 0.08 {
          self.captureLiftFrame(data)
          self.lifted = true
          onChange(true, 0, 0)
        }
      } else if onTable {
        self.highSince = nil
        if self.lowSince == nil { self.lowSince = now }
        if self.lifted, now - (self.lowSince ?? now) > 0.22 {
          let carry = self.phoneCarry()
          self.lifted = false
          onChange(false, carry.0, carry.1)
        }
      }
    }
  }

  private func captureLiftFrame(_ data: CMDeviceMotion) {
    let r = data.attitude.rotationMatrix
    var xLen = hypot(r.m11, r.m21)
    if xLen < 0.15 { xLen = 1 }
    liftXx = r.m11 / xLen
    liftXy = r.m21 / xLen
    var yLen = hypot(r.m12, r.m22)
    if yLen < 0.15 { yLen = 1 }
    liftYx = r.m12 / yLen
    liftYy = r.m22 / yLen
    vx = 0
    vy = 0
    px = 0
    py = 0
    lastT = data.timestamp
  }

  private func integrate(_ data: CMDeviceMotion) {
    let dt = lastT.map { data.timestamp - $0 } ?? 0.05
    lastT = data.timestamp
    guard dt > 0, dt < 0.25 else { return }
    let r = data.attitude.rotationMatrix
    let a = data.userAcceleration
    let wx = r.m11 * a.x + r.m12 * a.y + r.m13 * a.z
    let wy = r.m21 * a.x + r.m22 * a.y + r.m23 * a.z
    if hypot(wx, wy) < 0.12 {
      vx *= 0.5
      vy *= 0.5
    } else {
      vx += wx * dt
      vy += wy * dt
    }
    px += vx * dt
    py += vy * dt
  }

  private func phoneCarry() -> (Double, Double) {
    let cx = px * liftXx + py * liftXy
    let cy = px * liftYx + py * liftYy
    return (cx, cy)
  }
}
