(() => {
  const isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMac) return;

  const PROFILE_KEY = "highgas:native-profile-v1";
  const CLIPBOARD_PREFIX = "HIGHGAS-WG-V1:";
  let bypassNativeIntercept = false;

  const looksLikeWireGuard = (text) =>
    /\[Interface\]/i.test(text) &&
    /PrivateKey\s*=/i.test(text) &&
    /\[Peer\]/i.test(text) &&
    /PublicKey\s*=/i.test(text);

  const encodeBase64UTF8 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  };

  const legacyCopy = (text) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  };

  const stageProfileForNativeApp = async () => {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    if (!raw || !looksLikeWireGuard(raw)) return false;

    const payload = CLIPBOARD_PREFIX + encodeBase64UTF8(raw);
    if (legacyCopy(payload)) return true;

    try {
      await navigator.clipboard.writeText(payload);
      return true;
    } catch {
      return false;
    }
  };

  document.addEventListener(
    "change",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      const file = input.files?.[0];
      if (!file || file.size > 64 * 1024) return;

      void file.text().then((text) => {
        if (looksLikeWireGuard(text)) {
          sessionStorage.setItem(PROFILE_KEY, text);
        }
      });
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (bypassNativeIntercept) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest(".power-button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;

      const text = button.textContent || "";
      if (!/LIGAR VPN/i.test(text)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const selectedServer = localStorage.getItem("highgas:selected-server") || "br-sao-01";
      const nativeURL = `highgas://connect?server=${encodeURIComponent(selectedServer)}`;
      let nativeAppTookFocus = false;

      const markHandled = () => {
        nativeAppTookFocus = true;
      };

      window.addEventListener("blur", markHandled, { once: true });
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "hidden") nativeAppTookFocus = true;
        },
        { once: true }
      );

      const launch = () => {
        window.location.href = nativeURL;

        window.setTimeout(() => {
          if (nativeAppTookFocus) return;

          // Companion not installed (or custom URL was blocked): preserve the
          // existing web/WireGuard flow rather than dead-ending the user.
          bypassNativeIntercept = true;
          button.click();
          window.setTimeout(() => {
            bypassNativeIntercept = false;
          }, 0);
        }, 1400);
      };

      void stageProfileForNativeApp().finally(launch);
    },
    true
  );
})();
