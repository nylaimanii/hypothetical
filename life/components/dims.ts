// real sizes, in world units (1 unit = 1.7 m, so a 170 cm adult is 1.0). everything built in the scene takes its size
// from here, and the qa script checks these against people. ordinary building and vehicle standards (ESTIMATE where
// marked): a door ~2.0 m tall and ~0.9 m wide, a storey ~2.8 m floor to floor in these cities' block houses
// (ESTIMATE), a shop awning ~2.3 m up, a chair seat ~0.45 m, a table ~0.75 m, a sedan ~4.3 x 1.75 x 1.45 m, a
// bajaji (tuk-tuk) ~2.6 x 1.3 x 1.7 m, a minibus (hiace class) ~5.4 x 1.9 x 2.3 m, a motorbike ~2.0 x 0.75 x 1.1 m
export const M = 1 / 1.7
export const DIMS = {
  storey: 2.8 * M, door: 2.0 * M, doorW: 0.9 * M, shopDoor: 2.2 * M, windowSill: 1.0 * M, window: 1.0 * M,
  awning: 2.3 * M, plinth: 0.9 * M, stoop: 0.2, chairSeat: 0.45 * M, table: 0.75 * M,
  car: { l: 4.3 * M, w: 1.75 * M, h: 1.45 * M }, bajaji: { l: 2.6 * M, w: 1.3 * M, h: 1.7 * M },
  minibus: { l: 5.4 * M, w: 1.9 * M, h: 2.3 * M }, boda: { l: 2.0 * M, w: 0.75 * M, h: 1.1 * M },
}
