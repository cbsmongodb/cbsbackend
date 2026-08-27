import axios from "axios";

let lastCallTime = 0;
const MIN_INTERVAL_MS = 600;

async function throttle() {
  const wait = lastCallTime + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTime = Date.now();
}

export async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  await throttle();

  try {
    const response = await axios.get("https://us1.locationiq.com/v1/search", {
      params: {
        key: process.env.LOCATIONIQ_API_KEY,
        q: address,
        format: "json",
        limit: 1,
        countrycodes: "ge",
      },
    });

    if (response.data?.length > 0) {
      return {
        lat: parseFloat(response.data[0].lat),
        lng: parseFloat(response.data[0].lon),
      };
    }
    return null;
  } catch (err) {
    console.error(`geocode failed for "${address}":`, err.response?.data || err.message);
    return null;
  }
}

export async function searchAddress(query) {
  if (!query || !query.trim()) return [];
  await throttle();

  try {
    const response = await axios.get("https://us1.locationiq.com/v1/search", {
      params: {
        key: process.env.LOCATIONIQ_API_KEY,
        q: query,
        format: "json",
        limit: 5,
        countrycodes: "ge",
      },
    });

    return (response.data || []).map((r) => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));
  } catch (err) {
    console.error(`search failed for "${query}":`, err.response?.data || err.message);
    return [];
  }
}
