/*
 * Builds the Play Store URL that carries a first-party link through an Android
 * install (Play "install referrer"). The app reads `dl` on its first launch.
 *
 * Contract: referrer = encodeURIComponent('dl=' + encodeURIComponent(destination)).
 * The destination must be https://solgram.world/... (apex host), at most 512
 * characters, with no whitespace or control characters. Anything else returns
 * null so the caller keeps its existing redirect.
 */
(function (root) {
  var HOST = "solgram.world";
  var PLAY_URL = "https://play.google.com/store/apps/details?id=world.solgram.customer";
  var MAX_LENGTH = 512;
  var CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;

  function hasBadChars(value) {
    // whitespace or control characters (C0, DEL, C1)
    return /[\s\u0000-\u001f\u007f-\u009f]/.test(value);
  }

  // Returns the Play URL for a destination, or null when the destination
  // fails any of the app's rules.
  function playUrlFor(destination) {
    if (typeof destination !== "string" || destination.length === 0) return null;
    if (destination.length > MAX_LENGTH) return null;

    var decoded;
    try {
      decoded = decodeURIComponent(destination);
    } catch (e) {
      return null;
    }
    if (decoded.length > MAX_LENGTH) return null;
    if (hasBadChars(destination) || hasBadChars(decoded)) return null;

    var parsed;
    try {
      parsed = new URL(destination);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== HOST) return null;
    if (parsed.port !== "") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;

    var referrer = encodeURIComponent("dl=" + encodeURIComponent(destination));
    return PLAY_URL + "&referrer=" + referrer;
  }

  // The current page's own canonical URL: origin + path + query, without the
  // hash, `noredirect` (a debug switch) or utm_* (kept out of `dl`).
  function canonicalFromLocation(loc) {
    var params = [];
    var search = (loc.search || "").replace(/^\?/, "");
    if (search) {
      search.split("&").forEach(function (pair) {
        if (!pair) return;
        var name = pair.split("=")[0];
        var lower = name.toLowerCase();
        if (lower === "noredirect" || lower.indexOf("utm_") === 0) return;
        params.push(pair);
      });
    }
    return "https://" + loc.hostname + loc.pathname + (params.length ? "?" + params.join("&") : "");
  }

  // Referral link: built from the code, not from the raw URL, so both
  // parameters are always present and the code is always well formed.
  function referralDestination(code) {
    if (typeof code !== "string" || !CODE_RE.test(code)) return null;
    var c = encodeURIComponent(code);
    return "https://" + HOST + "/referral?referral_code=" + c + "&deep_link_sub1=" + c;
  }

  var api = {
    playUrlFor: playUrlFor,
    canonicalFromLocation: canonicalFromLocation,
    referralDestination: referralDestination,
  };

  root.solgramPlayReferrer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
