export const STORAGE_KEY = "prefecture-minigame-v2";
export const QUESTION_SECONDS = 15;
export const SKILLS = {
  A: { name: "形", unlockAt: 0 },
  B: { name: "位置", unlockAt: 0 },
  C: { name: "地方区分", unlockAt: 3 },
  D: { name: "県庁所在地", unlockAt: 8 },
  E: { name: "郷土料理", unlockAt: 15 },
  F: { name: "有名都市", unlockAt: 22 },
  G: { name: "主要駅", unlockAt: 30 }
};
export const LOCATION_TYPES = ["locate", "locateJapan", "mapMemory", "shapeLocate", "capitalLocate", "dishLocate", "cityLocate", "stationLocate"];
export const NATIONWIDE_LOCATION_TYPES = ["locateJapan", "shapeLocate", "capitalLocate", "dishLocate", "cityLocate", "stationLocate"];
export const ANIMATED_TYPES = ["spotlight", "reveal", "flash", "slitFlow", "mapMemory", "mapFlash", "shapeLocate"];
export const EXAM_TYPES = { A: "silhouette", B: "mapChoice", C: "region", D: "capital", E: "dishReverse", F: "city", G: "station" };
export const EXAM_REGION_COUNTS = { "北海道地方": 1, "東北地方": 4, "関東地方": 4, "中部地方": 6, "近畿地方": 4, "中国地方": 3, "四国地方": 3, "九州地方": 5 };
export const STAGES = ["未学習", "学び始め", "探索中", "基礎づくり", "アマチュア", "プロ", "ベテラン", "マスター", "愛国者", "都道府県を極めしもの", "歩く地図帳", "完全制覇"];
