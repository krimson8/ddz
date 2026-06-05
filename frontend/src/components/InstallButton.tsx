"use client";

import { useEffect, useState } from "react";

/**
 * The `beforeinstallprompt` event (Chromium only — not in the TS lib yet).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True when the app is already running as an installed PWA. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag instead of display-mode.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as Mac, so also check for touch + no MSStream.
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return (iOSDevice || iPadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/**
 * Install-this-PWA button. On Chromium it triggers the real native install
 * prompt; on iOS Safari (which has no install API) it opens an instructions
 * modal showing the Share → Add to Home Screen steps. Renders nothing once the
 * app is already installed.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setInstalled(isStandalone());

    const onBeforeInstall = (e: Event) => {
      // Stop Chrome's mini-infobar; we drive the prompt from our button.
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Avoid SSR/client mismatch — decide visibility only after mount.
  if (!mounted || installed) return null;

  const ios = isIOS();
  // Show the button if we have a native prompt (Chromium) OR we're on iOS
  // (where we fall back to instructions). Otherwise there's nothing useful to do.
  if (!deferredPrompt && !ios) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferredPrompt(null);
    } else if (ios) {
      setShowIOSHelp(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1 text-sm font-medium transition-colors ${className}`}
        aria-label="安裝應用程式"
      >
        <span aria-hidden>⬇️</span> 安裝
      </button>

      {showIOSHelp && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={() => setShowIOSHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-green-800 p-5 text-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-3">安裝到主畫面</h3>
            <ol className="space-y-2 text-sm text-white/90">
              <li>
                1. 點擊瀏覽器下方的「分享」按鈕{" "}
                <span aria-hidden className="inline-block align-middle">
                  􀈂
                </span>
                （方框加向上箭頭）。
              </li>
              <li>2. 向下滑動，選擇「加入主畫面 / Add to Home Screen」。</li>
              <li>3. 點擊右上角「加入 / Add」即可。</li>
            </ol>
            <p className="mt-3 text-xs text-white/50">
              （iOS 僅能透過 Safari 安裝，無法自動完成。）
            </p>
            <button
              onClick={() => setShowIOSHelp(false)}
              className="mt-4 w-full rounded-lg bg-white/15 hover:bg-white/25 py-2 text-sm font-medium transition-colors"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
}
