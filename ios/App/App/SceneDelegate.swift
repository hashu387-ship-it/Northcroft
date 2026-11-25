import UIKit
import Capacitor
import NorthcroftNativePlugin

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        // Opened from the app icon's press-and-hold menu, the widget or Live Activity
        // (northcroft://action/...), or a Calendar event (northcroft://open/...).
        // The web app does the action once it has loaded (NorthcroftNative.takeLaunchAction).
        if let item = connectionOptions.shortcutItem {
            LaunchActions.handle(shortcutType: item.type)
        }
        for context in connectionOptions.urlContexts {
            LaunchActions.handle(url: context.url)
        }
        // Opened from a Spotlight result.
        for activity in connectionOptions.userActivities {
            LaunchActions.handle(activity: activity)
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // The widget's links are ours; anything else goes on to Capacitor as before.
        let others = URLContexts.filter { !LaunchActions.handle(url: $0.url) }
        if !others.isEmpty {
            SceneDelegateProxy.shared.scene(scene, openURLContexts: others)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // A Spotlight result is ours; anything else goes on to Capacitor as before.
        if !LaunchActions.handle(activity: userActivity) {
            SceneDelegateProxy.shared.scene(scene, continue: userActivity)
        }
    }

    /// A press-and-hold menu item while Northcroft is already running.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(LaunchActions.handle(shortcutType: shortcutItem.type))
    }
}
