import { api } from "./client";

export async function fetchRoutesGeo() {
  const { data } = await api.get("/api/routes/geojson");
  return data;
}

export async function fetchStopsGeo() {
  const { data } = await api.get("/api/stops/geojson");
  return data;
}