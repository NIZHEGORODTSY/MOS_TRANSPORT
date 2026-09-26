import {api} from "./client";   // инстанс axios с baseURL и интерцепторами

export async function fetchStops() {
    const {data} = await api.get("/api/stops");
    console.loh(data);
    return data;
    // массив объектов
}