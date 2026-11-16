"use client";

import { useEffect } from "react";
import { registerPushDevice } from "@/app/(platform)/push-actions";

/** What the app's bridge exposes. Absent in a browser, and on a web view too old to be injected. */
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/**
 * Asks for notification permission once the person is signed in, and tells the server which
 * phone they are on. Renders nothing.
 *
 * Does nothing at all in a browser, which is most visitors - the plugin is only fetched after
 * the bridge has been found, so the web bundle never carries it. It is also silent when the
 * bridge is missing on a device too old for it, because an app without notifications is still
 * an app, and there is nothing a farmer could do about the error anyway.
 *
 * Permission is asked for here rather than at launch on purpose: by this point they have signed
 * in and know what Sagora is, so the request has a reason behind it.
 */
export function PushRegistrar() {
  useEffect(() => {
    let dropped = false;

    void (async () => {
      try {
        const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        const platform = cap.getPlatform?.() ?? "android";

        const { PushNotifications } = await import("@capacitor/push-notifications");
        const current = await PushNotifications.checkPermissions();
        const granted =
          current.receive === "granted" ||
          (current.receive === "prompt" && (await PushNotifications.requestPermissions()).receive === "granted");
        if (!granted || dropped) return;

        // Firebase answers with the token asynchronously, so the listener goes on before asking.
        await PushNotifications.addListener("registration", (token) => {
          void registerPushDevice(token.value, platform);
        });
        await PushNotifications.register();
      } catch {
        // No notifications on this device. Everything else carries on exactly as before.
      }
    })();

    return () => {
      dropped = true;
    };
  }, []);

  return null;
}
