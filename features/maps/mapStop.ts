/** Tipo compartilhado entre as versoes nativa e web do mapa (ver RouteMap.tsx / RouteMap.web.tsx). */
export type MapStop = {
  id: string;
  sequence: number;
  dogName: string;
  address?: string | null;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
};
