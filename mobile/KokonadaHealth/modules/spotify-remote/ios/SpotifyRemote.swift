import Foundation
import React

@objc(SpotifyRemote)
class SpotifyRemote: NSObject {
  private func unsupported(_ reject: RCTPromiseRejectBlock) {
    reject("UNSUPPORTED", "Spotify App Remote is not implemented on iOS yet", nil)
  }

  @objc func configure(_ clientId: String, redirectUri: String) {}
  @objc func addListener(_ eventName: String) {}
  @objc func removeListeners(_ count: Double) {}

  @objc func isSpotifyInstalled(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(false)
  }
  @objc func connect(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func disconnect(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func isConnected(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { resolve(false) }
  @objc func playUri(_ uri: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func pause(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func resume(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
  @objc func getPlayerState(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) { unsupported(reject) }
}
