import Foundation
import NearbyInteraction
import simd

final class NearbyRanging: NSObject, ObservableObject, NISessionDelegate {
  @Published var distances: [String: Float] = [:]
  @Published var hint = "UWB starting…"

  var onToken: ((String) -> Void)?
  var onDistance: ((String, Float, Float?, Float?, Float?) -> Void)?

  private var session = NISession()
  private var myId = ""
  private var peerId: String?
  private var peerTokenBlob: String?
  private var lastSent: TimeInterval = 0
  private var lastDir: simd_float3?
  private var lastAngle: Float?
  private var retryWork: DispatchWorkItem?
  private var ping: Timer?

  func start() {
    guard NISession.isSupported else {
      hint = "This iPhone has no UWB"
      return
    }
    attachSession()
    republishToken()
    ping?.invalidate()
    ping = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
      self?.republishToken()
    }
  }

  func republishToken() {
    attachSession()
    if let token = session.discoveryToken, let encoded = Self.encode(token) {
      onToken?(encoded)
    } else {
      hint = "Waiting for this phone’s UWB token"
    }
  }

  func syncPeers(_ tokens: [String: String], myId: String) {
    self.myId = myId
    guard NISession.isSupported else { return }
    let others = tokens.filter { $0.key != myId }
    guard let other = others.first else {
      hint = "Waiting for the other phone"
      return
    }
    guard let token = Self.decode(other.value) else {
      hint = "Bad UWB token from \(other.key.prefix(4))"
      return
    }
    if other.key == peerId, other.value == peerTokenBlob {
      return
    }
    peerId = other.key
    peerTokenBlob = other.value
    lastDir = nil
    lastAngle = nil
    run(with: token)
  }

  func reset() {
    retryWork?.cancel()
    peerId = nil
    peerTokenBlob = nil
    lastDir = nil
    lastAngle = nil
    distances = [:]
    hint = "UWB idle"
  }

  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    guard let peerId else { return }
    let object = nearbyObjects.first
    guard let meters = object?.distance, meters.isFinite, meters > 0 else { return }

    if let dir = object?.direction, simd_length(dir) > 0.05 {
      lastDir = dir
    }

    var angle = lastAngle
    if #available(iOS 16.0, *) {
      if let ha = object?.horizontalAngle {
        lastAngle = ha
        angle = ha
      }
    }

    let dir = lastDir
    DispatchQueue.main.async {
      self.distances[peerId] = meters
      if let dir {
        self.hint = String(
          format: "%.0f cm  AoA %.0f°",
          meters * 100,
          atan2(Double(dir.x), Double(dir.y)) * 180 / .pi
        )
      } else if let angle {
        self.hint = String(format: "%.0f cm  az %.0f°", meters * 100, Double(angle) * 180 / .pi)
      } else {
        self.hint = String(format: "%.0f cm  no AoA — tilt the back toward the other phone once", meters * 100)
      }
      let now = Date().timeIntervalSince1970
      guard now - self.lastSent >= 0.08 else { return }
      self.lastSent = now
      if let dir {
        self.onDistance?(peerId, meters, dir.x, dir.y, dir.z)
      } else if let angle {
        self.onDistance?(peerId, meters, sin(angle), cos(angle), 0)
      } else {
        self.onDistance?(peerId, meters, nil, nil, nil)
      }
    }
  }

  func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
    DispatchQueue.main.async {
      self.hint = reason == .timeout ? "UWB lost — hold screens up" : "Other phone left UWB"
      self.scheduleRetry()
    }
  }

  func sessionWasSuspended(_ session: NISession) {
    DispatchQueue.main.async { self.hint = "UWB paused" }
  }

  func sessionSuspensionEnded(_ session: NISession) {
    DispatchQueue.main.async {
      self.republishToken()
      self.rerunIfNeeded()
    }
  }

  func session(_ session: NISession, didInvalidateWith error: Error) {
    DispatchQueue.main.async {
      self.hint = "UWB reset: \(error.localizedDescription)"
      self.replaceSession()
      self.scheduleRetry()
    }
  }

  private func attachSession() {
    session.delegate = self
  }

  private func replaceSession() {
    session.invalidate()
    session = NISession()
    session.delegate = self
  }

  private func run(with token: NIDiscoveryToken) {
    attachSession()
    let config = NINearbyPeerConfiguration(peerToken: token)
    if #available(iOS 16.0, *) {
      if NISession.deviceCapabilities.supportsCameraAssistance {
        config.isCameraAssistanceEnabled = true
      }
    }
    session.run(config)
    republishToken()
    if distances.isEmpty {
      hint = "Ranging \(peerId?.prefix(4) ?? "peer")…"
    }
  }

  private func rerunIfNeeded() {
    guard let blob = peerTokenBlob, let token = Self.decode(blob) else { return }
    run(with: token)
  }

  private func scheduleRetry() {
    retryWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.replaceSession()
      self?.republishToken()
      self?.rerunIfNeeded()
    }
    retryWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
  }

  private static func encode(_ token: NIDiscoveryToken) -> String? {
    guard let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    else { return nil }
    return data.base64EncodedString()
  }

  private static func decode(_ payload: String) -> NIDiscoveryToken? {
    guard let data = Data(base64Encoded: payload) else { return nil }
    return try? NSKeyedUnarchiver.unarchivedObject(ofClass: NIDiscoveryToken.self, from: data)
  }
}
