// Dark whenever the system asks for it, and otherwise from sunset to sunrise
// where the listener is. The place comes from the time zone's principal city,
// so there is no location prompt; that is within half an hour or so of the real
// sunset. Runs in the head, before the first paint, and dispatches "themechange"
// on window when the theme flips.

const systemPrefersDark = matchMedia("(prefers-color-scheme: dark)");

function listenerPlace() {
  const [area, ...rest] = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/"),
    city = rest.length && timezoneCoordinates[area]?.split(",").find((entry) => entry.startsWith(`${rest.join("/")} `));
  if (city) return city.split(" ").slice(1).map(Number);
  // Unknown zone (UTC, Etc/GMT+5): assume the equator at the clock's meridian.
  return [0, -new Date().getTimezoneOffset() / 4];
}

// The sun's altitude in radians (the low-precision formulas behind SunCalc,
// accurate to a minute or two). Works through polar day and night, where the
// sun never crosses the horizon at all.
function sunAltitude(date, latitude, longitude) {
  const radians = Math.PI / 180,
    days = date / 864e5 - 10957.5, // since 2000-01-01 12:00 UTC
    anomaly = radians * (357.5291 + 0.98560028 * days),
    center = radians * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly)),
    ecliptic = anomaly + center + radians * 102.9372 + Math.PI,
    obliquity = radians * 23.4397,
    declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic)),
    ascension = Math.atan2(Math.sin(ecliptic) * Math.cos(obliquity), Math.cos(ecliptic)),
    hourAngle = radians * (280.16 + 360.9856235 * days + longitude) - ascension,
    phi = radians * latitude;
  return Math.asin(
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle),
  );
}

function applyTheme() {
  const [latitude, longitude] = listenerPlace(),
    // Below -0.833° the sun's upper edge has set, allowing for refraction.
    sunDown = sunAltitude(Date.now(), latitude, longitude) < (-0.833 * Math.PI) / 180,
    theme = systemPrefersDark.matches || sunDown ? "dark" : "light",
    root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  dispatchEvent(new Event("themechange"));
}

applyTheme();
systemPrefersDark.addEventListener("change", applyTheme);
// A minute's check is enough for sunset; timers stall while a laptop sleeps or a
// tab is in the background, so also check on return.
setInterval(applyTheme, 60_000);
document.addEventListener("visibilitychange", () => document.hidden || applyTheme());
addEventListener("focus", applyTheme);
