import type { Item } from '../types';

export const ITEMS: Item[] = [
  {
    id: 'adamant',
    name: {
      ja: '金剛石',
      en: 'Adamant'
    },
    sortName: {
      ja: 'こんごうせき'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'advanced_fertilizer',
    name: {
      ja: '上級肥料',
      en: 'Advanced Fertilizer'
    },
    sortName: {
      ja: 'じょうきゅうひりょう'
    },
    category: 'fertilizer',
    physicalState: 'solid',
    fertilizerValue: 720,
    fertilizerNutrientsPerSec: 144
  },
  {
    id: 'aqua_vitae',
    name: {
      ja: '生命の水',
      en: 'Aqua Vitae'
    },
    sortName: {
      ja: 'せいめいのみず'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'bandage',
    name: {
      ja: '包帯',
      en: 'Bandage'
    },
    sortName: {
      ja: 'ほうたい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 350
  },
  {
    id: 'basic_fertilizer',
    name: {
      ja: '初級肥料',
      en: 'Basic Fertilizer'
    },
    sortName: {
      ja: 'しょきゅうひりょう'
    },
    category: 'fertilizer',
    physicalState: 'solid',
    fertilizerValue: 144,
    fertilizerNutrientsPerSec: 12
  },
  {
    id: 'black_powder',
    name: {
      ja: '火薬',
      en: 'Black Powder'
    },
    sortName: {
      ja: 'かやく'
    },
    category: 'fuel',
    physicalState: 'solid',
    sellPriceCopper: 330,
    fuelValue: 3000
  },
  {
    id: 'blast_potion',
    name: {
      ja: '爆発ポーション',
      en: 'Blast Potion'
    },
    sortName: {
      ja: 'ばくはつぽーしょん'
    },
    category: 'fuel',
    physicalState: 'solid',
    sellPriceCopper: 2557,
    fuelValue: 24000
  },
  {
    id: 'brandy',
    name: {
      ja: 'ブランデー',
      en: 'Brandy'
    },
    sortName: {
      ja: 'ぶらんでー'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'brick',
    name: {
      ja: 'レンガ',
      en: 'Brick'
    },
    sortName: {
      ja: 'れんが'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 70
  },
  {
    id: 'brine',
    name: {
      ja: '塩水',
      en: 'Brine'
    },
    sortName: {
      ja: 'えんすい'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'broken_shard',
    name: {
      ja: '破損チップ',
      en: 'Broken Shard'
    },
    sortName: {
      ja: 'はそんちっぷ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'bronze_ingot',
    name: {
      ja: '青銅インゴット',
      en: 'Bronze Ingot'
    },
    sortName: {
      ja: 'せいどういんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'bronze_rivet',
    name: {
      ja: '青銅リベット',
      en: 'Bronze Rivet'
    },
    sortName: {
      ja: 'せいどうりべっと'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 120
  },
  {
    id: 'chamomile',
    name: {
      ja: 'カモミール',
      en: 'Chamomile'
    },
    sortName: {
      ja: 'かもみーる'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'chamomile_powder',
    name: {
      ja: 'カモミールの粉末',
      en: 'Chamomile Powder'
    },
    sortName: {
      ja: 'かもみーるのふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'chamomile_seeds',
    name: {
      ja: 'カモミールの種',
      en: 'Chamomile Seeds'
    },
    sortName: {
      ja: 'かもみーるのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 6000
  },
  {
    id: 'charcoal',
    name: {
      ja: '木炭',
      en: 'Charcoal'
    },
    sortName: {
      ja: 'もくたん'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 40
  },
  {
    id: 'charcoal_powder',
    name: {
      ja: '木炭の粉末',
      en: 'Charcoal Powder'
    },
    sortName: {
      ja: 'もくたんのふんまつ'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 48
  },
  {
    id: 'clay',
    name: {
      ja: '粘土',
      en: 'Clay'
    },
    sortName: {
      ja: 'ねんど'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'clay_powder',
    name: {
      ja: '粘土粉末',
      en: 'Clay Powder'
    },
    sortName: {
      ja: 'ねんどふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'coal',
    name: {
      ja: '石炭',
      en: 'Coal'
    },
    sortName: {
      ja: 'せきたん'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 540
  },
  {
    id: 'coal_ore',
    name: {
      ja: '石炭鉱石',
      en: 'Coal Ore'
    },
    sortName: {
      ja: 'せきたんこうせき'
    },
    category: 'fuel',
    physicalState: 'solid',
    buyPriceCopper: 4800,
    fuelValue: 30000
  },
  {
    id: 'coke',
    name: {
      ja: 'コークス',
      en: 'Coke'
    },
    sortName: {
      ja: 'こーくす'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 600
  },
  {
    id: 'coke_powder',
    name: {
      ja: 'コークス粉',
      en: 'Coke Powder'
    },
    sortName: {
      ja: 'こーくすふん'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 660
  },
  {
    id: 'clockwork_bird',
    name: {
      ja: 'ゼンマイ鳥',
      en: 'Clockwork Bird'
    },
    sortName: {
      ja: 'ぜんまいどり'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 5000
  },
  {
    id: 'copper_bearing',
    name: {
      ja: '銅ベアリング',
      en: 'Copper Bearing'
    },
    sortName: {
      ja: 'どうべありんぐ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 300
  },
  {
    id: 'copper_coin',
    name: {
      ja: '銅貨',
      en: 'Copper Coin'
    },
    sortName: {
      ja: 'どうか'
    },
    category: 'intermediate',
    physicalState: 'solid',
    buyPriceCopper: 1,
    sellPriceCopper: 1
  },
  {
    id: 'copper_ingot',
    name: {
      ja: '銅インゴット',
      en: 'Copper Ingot'
    },
    sortName: {
      ja: 'どういんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'copper_powder',
    name: {
      ja: '銅粉',
      en: 'Copper Powder'
    },
    sortName: {
      ja: 'どうふん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'crown',
    name: {
      ja: '王冠',
      en: 'Crown'
    },
    sortName: {
      ja: 'おうかん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 1600000
  },
  {
    id: 'crude_crystal',
    name: {
      ja: '荒い晶石',
      en: 'Crude Crystal'
    },
    sortName: {
      ja: 'あらいしょうせき'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'crude_gold_dust',
    name: {
      ja: '粗悪な砂金',
      en: 'Crude Gold Dust'
    },
    sortName: {
      ja: 'そあくなさきん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'crude_shard',
    name: {
      ja: '粗悪なチップ',
      en: 'Crude Shard'
    },
    sortName: {
      ja: 'そあくなちっぷ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'crude_silver_powder',
    name: {
      ja: '粗悪な銀粉',
      en: 'Crude Silver Powder'
    },
    sortName: {
      ja: 'そあくなぎんぷん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'diamond',
    name: {
      ja: 'ダイヤモンド',
      en: 'Diamond'
    },
    sortName: {
      ja: 'だいやもんど'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 100000
  },
  {
    id: 'dull_shard',
    name: {
      ja: 'くすんだチップ',
      en: 'Dull Shard'
    },
    sortName: {
      ja: 'くすんだちっぷ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'emerald',
    name: {
      ja: 'エメラルド',
      en: 'Emerald'
    },
    sortName: {
      ja: 'えめらるど'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 700000
  },
  {
    id: 'eternal_catalyst',
    name: {
      ja: '永遠の触媒',
      en: 'Eternal Catalyst'
    },
    sortName: {
      ja: 'えいえんのしょくばい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'fairy_dust',
    name: {
      ja: '精霊の粉末',
      en: 'Fairy Dust'
    },
    sortName: {
      ja: 'せいれいのふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'fairy_tear',
    name: {
      ja: '精霊の涙',
      en: 'Fairy Tear'
    },
    sortName: {
      ja: 'せいれいのなみだ'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'fertile_catalyst',
    name: {
      ja: '豊穣の触媒',
      en: 'Fertile Catalyst'
    },
    sortName: {
      ja: 'ほうじょうのしょくばい'
    },
    category: 'fertilizer',
    physicalState: 'solid',
    fertilizerValue: 24000,
    fertilizerNutrientsPerSec: 6000
  },
  {
    id: 'flax',
    name: {
      ja: '亜麻',
      en: 'Flax'
    },
    sortName: {
      ja: 'あま'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'flax_fiber',
    name: {
      ja: '亜麻繊維',
      en: 'Flax Fiber'
    },
    sortName: {
      ja: 'あませんい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'flax_seeds',
    name: {
      ja: '亜麻の種',
      en: 'Flax Seeds'
    },
    sortName: {
      ja: 'あまのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 280
  },
  {
    id: 'fruit_wine',
    name: {
      ja: 'ベリー酒',
      en: 'Fruit Wine'
    },
    sortName: {
      ja: 'べりーしゅ'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'fully_refined_sand',
    name: {
      ja: '完璧な精錬砂',
      en: 'Fully Refined Sand'
    },
    sortName: {
      ja: 'かんぺきなせいれんすな'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gentian',
    name: {
      ja: 'リンドウ',
      en: 'Gentian'
    },
    sortName: {
      ja: 'りんどう'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gentian_nectar',
    name: {
      ja: 'リンドウの蜜',
      en: 'Gentian Nectar'
    },
    sortName: {
      ja: 'りんどうのみつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gentian_powder',
    name: {
      ja: 'リンドウの粉末',
      en: 'Gentian Powder'
    },
    sortName: {
      ja: 'りんどうのふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gentian_seeds',
    name: {
      ja: 'リンドウの種',
      en: 'Gentian Seeds'
    },
    sortName: {
      ja: 'りんどうのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 64000
  },
  {
    id: 'glass',
    name: {
      ja: 'ガラス',
      en: 'Glass'
    },
    sortName: {
      ja: 'がらす'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 75
  },
  {
    id: 'gloom_fungus',
    name: {
      ja: '幽暗キノコ',
      en: 'Gloom Fungus'
    },
    sortName: {
      ja: 'ゆうあんきのこ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gloom_spores',
    name: {
      ja: '幽暗胞子',
      en: 'Gloom Spores'
    },
    sortName: {
      ja: 'ゆうあんほうし'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gold_coin',
    name: {
      ja: '金貨',
      en: 'Gold Coin'
    },
    sortName: {
      ja: 'きんか'
    },
    category: 'intermediate',
    physicalState: 'solid',
    buyPriceCopper: 100000,
    sellPriceCopper: 100000
  },
  {
    id: 'gold_dust',
    name: {
      ja: '砂金',
      en: 'Gold Dust'
    },
    sortName: {
      ja: 'さきん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'gold_ingot',
    name: {
      ja: '金インゴット',
      en: 'Gold Ingot'
    },
    sortName: {
      ja: 'きんいんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'growth_potion',
    name: {
      ja: '成長ポーション',
      en: 'Growth Potion'
    },
    sortName: {
      ja: 'せいちょうぽーしょん'
    },
    category: 'fertilizer',
    physicalState: 'solid',
    sellPriceCopper: 1224,
    fertilizerValue: 6480,
    fertilizerNutrientsPerSec: 2160
  },
  {
    id: 'healing_potion',
    name: {
      ja: '回復ポーション',
      en: 'Healing Potion'
    },
    sortName: {
      ja: 'かいふくぽーしょん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 85
  },
  {
    id: 'impure_copper_powder',
    name: {
      ja: '不純銅粉',
      en: 'Impure Copper Powder'
    },
    sortName: {
      ja: 'ふじゅんどうふん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'impure_gold_dust',
    name: {
      ja: '不純砂金',
      en: 'Impure Gold Dust'
    },
    sortName: {
      ja: 'ふじゅんさきん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'impure_silver_powder',
    name: {
      ja: '不純銀粉',
      en: 'Impure Silver Powder'
    },
    sortName: {
      ja: 'ふじゅんぎんぷん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'iron_ingot',
    name: {
      ja: '鉄インゴット',
      en: 'Iron Ingot'
    },
    sortName: {
      ja: 'てついんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'iron_nails',
    name: {
      ja: '鉄釘',
      en: 'Iron Nails'
    },
    sortName: {
      ja: 'てつくぎ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 16
  },
  {
    id: 'iron_ore',
    name: {
      ja: '鉄鉱石',
      en: 'Iron Ore'
    },
    sortName: {
      ja: 'てっこうせき'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 1200
  },
  {
    id: 'iron_sand',
    name: {
      ja: '砂鉄',
      en: 'Iron Sand'
    },
    sortName: {
      ja: 'さてつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'jupiter',
    name: {
      ja: '木星',
      en: 'Jupiter'
    },
    sortName: {
      ja: 'もくせい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 30000
  },
  {
    id: 'lapis_lazuli',
    name: {
      ja: 'ラピスラズリ',
      en: 'Lapis Lazuli'
    },
    sortName: {
      ja: 'らぴすらずり'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 32000
  },
  {
    id: 'large_wooden_gear',
    name: {
      ja: '木製の大歯車',
      en: 'Large Wooden Gear'
    },
    sortName: {
      ja: 'もくせいのおおはぐるま'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 5
  },
  {
    id: 'lavender',
    name: {
      ja: 'ラベンダー',
      en: 'Lavender'
    },
    sortName: {
      ja: 'らべんだー'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'lavender_essential_oil',
    name: {
      ja: 'ラベンダー精油',
      en: 'Lavender Essential Oil'
    },
    sortName: {
      ja: 'らべんだーせいゆ'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'lavender_seeds',
    name: {
      ja: 'ラベンダーの種',
      en: 'Lavender Seeds'
    },
    sortName: {
      ja: 'らべんだーのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 16000
  },
  {
    id: 'limestone',
    name: {
      ja: '石灰石',
      en: 'Limestone'
    },
    sortName: {
      ja: 'せっかいせき'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 600
  },
  {
    id: 'limewater',
    name: {
      ja: '石灰水',
      en: 'Limewater'
    },
    sortName: {
      ja: 'せっかいすい'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'linen',
    name: {
      ja: '麻布',
      en: 'Linen'
    },
    sortName: {
      ja: 'あさぬの'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 165
  },
  {
    id: 'linen_rope',
    name: {
      ja: '麻縄',
      en: 'Linen Rope'
    },
    sortName: {
      ja: 'あさなわ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 36
  },
  {
    id: 'linen_thread',
    name: {
      ja: '麻糸',
      en: 'Linen Thread'
    },
    sortName: {
      ja: 'あさいと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'linseed_oil',
    name: {
      ja: '亜麻仁油',
      en: 'Linseed Oil'
    },
    sortName: {
      ja: 'あまにゆ'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'logs',
    name: {
      ja: '原木',
      en: 'Logs'
    },
    sortName: {
      ja: 'げんぼく'
    },
    category: 'fuel',
    physicalState: 'solid',
    buyPriceCopper: 200,
    fuelValue: 2000
  },
  {
    id: 'luna',
    name: {
      ja: 'ルナ',
      en: 'Luna'
    },
    sortName: {
      ja: 'るな'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 18500000
  },
  {
    id: 'malachite',
    name: {
      ja: 'マラカイト',
      en: 'Malachite'
    },
    sortName: {
      ja: 'まらかいと'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 1020
  },
  {
    id: 'mars',
    name: {
      ja: '火星',
      en: 'Mars'
    },
    sortName: {
      ja: 'かせい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 280000
  },
  {
    id: 'mercury',
    name: {
      ja: '水星',
      en: 'Mercury'
    },
    sortName: {
      ja: 'すいせい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 5200000
  },
  {
    id: 'meteorite',
    name: {
      ja: '隕石',
      en: 'Meteorite'
    },
    sortName: {
      ja: 'いんせき'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 2000000
  },
  {
    id: 'moon_tear',
    name: {
      ja: '月の涙',
      en: 'Moon Tear'
    },
    sortName: {
      ja: 'つきのなみだ'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'moonlit_soap',
    name: {
      ja: '月光石鹸',
      en: 'Moonlit Soap'
    },
    sortName: {
      ja: 'げっこうせっけん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 900000
  },
  {
    id: 'mortar',
    name: {
      ja: '乳鉢',
      en: 'Mortar'
    },
    sortName: {
      ja: 'にゅうばち'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 48
  },
  {
    id: 'oblivion_essence',
    name: {
      ja: '消滅エッセンス',
      en: 'Oblivion Essence'
    },
    sortName: {
      ja: 'しょうめつえっせんす'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'obsidian',
    name: {
      ja: '黒曜石',
      en: 'Obsidian'
    },
    sortName: {
      ja: 'こくようせき'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 11000
  },
  {
    id: 'panacea_potion',
    name: {
      ja: '万能薬',
      en: 'Panacea Potion'
    },
    sortName: {
      ja: 'ばんのうやく'
    },
    category: 'fertilizer',
    physicalState: 'solid',
    sellPriceCopper: 30000,
    fuelValue: 320000,
    fertilizerValue: 200000,
    fertilizerNutrientsPerSec: 20000
  },
  {
    id: 'perfect_diamond',
    name: {
      ja: '完璧なダイヤモンド',
      en: 'Perfect Diamond'
    },
    sortName: {
      ja: 'かんぺきなだいやもんど'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'perfumed_soap',
    name: {
      ja: '香り石鹸',
      en: 'Perfumed Soap'
    },
    sortName: {
      ja: 'かおりせっけん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 2590
  },
  {
    id: 'perfumed_soap_powder',
    name: {
      ja: '粉末香り石鹸',
      en: 'Perfumed Soap Powder'
    },
    sortName: {
      ja: 'ふんまつかおりせっけん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'philosophers_stone',
    name: {
      ja: '賢者の石',
      en: "Philosopher's Stone"
    },
    sortName: {
      ja: 'けんじゃのいし'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'plank',
    name: {
      ja: '木材',
      en: 'Plank'
    },
    sortName: {
      ja: 'もくざい'
    },
    category: 'fuel',
    physicalState: 'solid',
    fuelValue: 20
  },
  {
    id: 'plant_ash',
    name: {
      ja: '草木灰',
      en: 'Plant Ash'
    },
    sortName: {
      ja: 'そうもくばい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'pocket_watch',
    name: {
      ja: '懐中時計',
      en: 'Pocket Watch'
    },
    sortName: {
      ja: 'かいちゅうどけい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 1950
  },
  {
    id: 'polished_crystal',
    name: {
      ja: '研磨晶石',
      en: 'Polished Crystal'
    },
    sortName: {
      ja: 'けんましょうせき'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'pure_gold_dust',
    name: {
      ja: '純粋砂金',
      en: 'Pure Gold Dust'
    },
    sortName: {
      ja: 'じゅんすいさきん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'pyrite_ore',
    name: {
      ja: '白鉄鉱',
      en: 'Pyrite Ore'
    },
    sortName: {
      ja: 'はくてっこう'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 11000
  },
  {
    id: 'quartz_ore',
    name: {
      ja: '石英鉱石',
      en: 'Quartz Ore'
    },
    sortName: {
      ja: 'せきえいこうせき'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 44000
  },
  {
    id: 'quicklime',
    name: {
      ja: '生石灰',
      en: 'Quicklime'
    },
    sortName: {
      ja: 'せいせっかい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'quicklime_powder',
    name: {
      ja: '石灰粉',
      en: 'Quicklime Powder'
    },
    sortName: {
      ja: 'せっかいふん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'quicksilver',
    name: {
      ja: '水銀',
      en: 'Quicksilver'
    },
    sortName: {
      ja: 'すいぎん'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'redcurrant',
    name: {
      ja: 'レッドカラント',
      en: 'Redcurrant'
    },
    sortName: {
      ja: 'れっどからんと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'redcurrant_seeds',
    name: {
      ja: 'レッドカラントの種',
      en: 'Redcurrant Seeds'
    },
    sortName: {
      ja: 'れっどからんとのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 1300
  },
  {
    id: 'refined_sand_1',
    name: {
      ja: '精錬砂1',
      en: 'Refined Sand 1'
    },
    sortName: {
      ja: 'せいれんすな1'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'refined_sand_2',
    name: {
      ja: '精錬砂2',
      en: 'Refined Sand 2'
    },
    sortName: {
      ja: 'せいれんすな2'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'refined_sand_3',
    name: {
      ja: '精錬砂3',
      en: 'Refined Sand 3'
    },
    sortName: {
      ja: 'せいれんすな3'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'refined_sand_4',
    name: {
      ja: '精錬砂4',
      en: 'Refined Sand 4'
    },
    sortName: {
      ja: 'せいれんすな4'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'refined_sand_5',
    name: {
      ja: '精錬砂5',
      en: 'Refined Sand 5'
    },
    sortName: {
      ja: 'せいれんすな5'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'resonant_catalyst',
    name: {
      ja: '共振触媒',
      en: 'Resonant Catalyst'
    },
    sortName: {
      ja: 'きょうしんしょくばい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'rock_salt',
    name: {
      ja: '岩塩',
      en: 'Rock Salt'
    },
    sortName: {
      ja: 'がんえん'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 9000
  },
  {
    id: 'rotten_log',
    name: {
      ja: '腐朽原木',
      en: 'Rotten Log'
    },
    sortName: {
      ja: 'ふきゅうげんぼく'
    },
    category: 'raw',
    physicalState: 'solid',
    buyPriceCopper: 2000
  },
  {
    id: 'ruby',
    name: {
      ja: 'ルビー',
      en: 'Ruby'
    },
    sortName: {
      ja: 'るびー'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 250000
  },
  {
    id: 'sage',
    name: {
      ja: 'セージ',
      en: 'Sage'
    },
    sortName: {
      ja: 'せーじ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sage_powder',
    name: {
      ja: 'セージの粉末',
      en: 'Sage Powder'
    },
    sortName: {
      ja: 'せーじのふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sage_seeds',
    name: {
      ja: 'セージの種',
      en: 'Sage Seeds'
    },
    sortName: {
      ja: 'せーじのたね'
    },
    category: 'seed',
    physicalState: 'solid',
    buyPriceCopper: 360
  },
  {
    id: 'salt',
    name: {
      ja: '塩',
      en: 'Salt'
    },
    sortName: {
      ja: 'しお'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 100
  },
  {
    id: 'sand',
    name: {
      ja: '砂',
      en: 'Sand'
    },
    sortName: {
      ja: 'すな'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sapphire',
    name: {
      ja: 'サファイア',
      en: 'Sapphire'
    },
    sortName: {
      ja: 'さふぁいあ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 480000
  },
  {
    id: 'saturn',
    name: {
      ja: '土星',
      en: 'Saturn'
    },
    sortName: {
      ja: 'どせい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 150000
  },
  {
    id: 'shattered_crystal',
    name: {
      ja: '砕けた晶石',
      en: 'Shattered Crystal'
    },
    sortName: {
      ja: 'くだけたしょうせき'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'silver_amulet',
    name: {
      ja: '銀の護符',
      en: 'Silver Amulet'
    },
    sortName: {
      ja: 'ぎんのごふ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 48000
  },
  {
    id: 'silver_coin',
    name: {
      ja: '銀貨',
      en: 'Silver Coin'
    },
    sortName: {
      ja: 'ぎんか'
    },
    category: 'intermediate',
    physicalState: 'solid',
    buyPriceCopper: 1000,
    sellPriceCopper: 1000
  },
  {
    id: 'silver_ingot',
    name: {
      ja: '銀インゴット',
      en: 'Silver Ingot'
    },
    sortName: {
      ja: 'ぎんいんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'silver_powder',
    name: {
      ja: '銀粉',
      en: 'Silver Powder'
    },
    sortName: {
      ja: 'ぎんぷん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'small_wooden_gear',
    name: {
      ja: '木製の小歯車',
      en: 'Small Wooden Gear'
    },
    sortName: {
      ja: 'もくせいのこはぐるま'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 8
  },
  {
    id: 'soap',
    name: {
      ja: '石鹸',
      en: 'Soap'
    },
    sortName: {
      ja: 'せっけん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 60
  },
  {
    id: 'soap_powder',
    name: {
      ja: '粉末石鹸',
      en: 'Soap Powder'
    },
    sortName: {
      ja: 'ふんまつせっけん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sol',
    name: {
      ja: 'ソル',
      en: 'Sol'
    },
    sortName: {
      ja: 'そる'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 42000000
  },
  {
    id: 'star_dust',
    name: {
      ja: '星の砂',
      en: 'Star Dust'
    },
    sortName: {
      ja: 'ほしのすな'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'steel_gear',
    name: {
      ja: '鋼の歯車',
      en: 'Steel Gear'
    },
    sortName: {
      ja: 'はがねのはぐるま'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 450
  },
  {
    id: 'steel_ingot',
    name: {
      ja: '鋼インゴット',
      en: 'Steel Ingot'
    },
    sortName: {
      ja: 'はがねいんごっと'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'stone',
    name: {
      ja: '砕石',
      en: 'Stone'
    },
    sortName: {
      ja: 'さいせき'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sulfur',
    name: {
      ja: '硫黄',
      en: 'Sulfur'
    },
    sortName: {
      ja: 'いおう'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sulfur_powder',
    name: {
      ja: '硫黄粉',
      en: 'Sulfur Powder'
    },
    sortName: {
      ja: 'いおうふん'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'sulfuric_acid',
    name: {
      ja: '硫酸',
      en: 'Sulfuric Acid'
    },
    sortName: {
      ja: 'りゅうさん'
    },
    category: 'intermediate',
    physicalState: 'liquid'
  },
  {
    id: 'topaz',
    name: {
      ja: 'トパーズ',
      en: 'Topaz'
    },
    sortName: {
      ja: 'とぱーず'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 2800
  },
  {
    id: 'transformation_potion',
    name: {
      ja: '変化ポーション',
      en: 'Transformation Potion'
    },
    sortName: {
      ja: 'へんかぽーしょん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 620
  },
  {
    id: 'turquoise',
    name: {
      ja: 'ターコイズ',
      en: 'Turquoise'
    },
    sortName: {
      ja: 'たーこいず'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 290
  },
  {
    id: 'unstable_catalyst',
    name: {
      ja: '不安定な触媒',
      en: 'Unstable Catalyst'
    },
    sortName: {
      ja: 'ふあんていなしょくばい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'venus',
    name: {
      ja: '金星',
      en: 'Venus'
    },
    sortName: {
      ja: 'きんせい'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 1000000
  },
  {
    id: 'vitality_essence',
    name: {
      ja: '生命のエッセンス',
      en: 'Vitality Essence'
    },
    sortName: {
      ja: 'せいめいのえっせんす'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'vitality_potion',
    name: {
      ja: '活力ポーション',
      en: 'Vitality Potion'
    },
    sortName: {
      ja: 'かつりょくぽーしょん'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 330
  },
  {
    id: 'volcanic_ash',
    name: {
      ja: '火山灰',
      en: 'Volcanic Ash'
    },
    sortName: {
      ja: 'かざんばい'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'wooden_pulley',
    name: {
      ja: '木製滑車',
      en: 'Wooden Pulley'
    },
    sortName: {
      ja: 'もくせいかっしゃ'
    },
    category: 'product',
    physicalState: 'solid',
    sellPriceCopper: 44
  },
  {
    id: 'world_tree_seed',
    name: {
      ja: '世界樹の種',
      en: 'World Tree Seed'
    },
    sortName: {
      ja: 'せかいじゅのたね'
    },
    category: 'seed',
    physicalState: 'solid'
  },
  {
    id: 'world_tree_core',
    name: {
      ja: '世界樹の核',
      en: 'World Tree Core'
    },
    sortName: {
      ja: 'せかいじゅのかく'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'world_tree_leaf',
    name: {
      ja: '世界樹の葉',
      en: 'World Tree Leaf'
    },
    sortName: {
      ja: 'せかいじゅのは'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'yeast_powder',
    name: {
      ja: '酵母粉末',
      en: 'Yeast Powder'
    },
    sortName: {
      ja: 'こうぼふんまつ'
    },
    category: 'intermediate',
    physicalState: 'solid'
  },
  {
    id: 'steam',
    name: {
      ja: '蒸気',
      en: 'Steam'
    },
    category: 'internal',
    physicalState: 'liquid',
    internal: true
  },
];

export const itemById: Record<string, Item> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item]),
);

export const fuelItemIds: string[] = ITEMS
  .filter((item) => item.fuelValue !== undefined)
  .sort((a, b) => (a.fuelValue ?? 0) - (b.fuelValue ?? 0) || a.id.localeCompare(b.id))
  .map((item) => item.id);

export const fertilizerItemIds: string[] = ITEMS
  .filter((item) => item.fertilizerValue !== undefined)
  .sort((a, b) => (a.fertilizerValue ?? 0) - (b.fertilizerValue ?? 0) || a.id.localeCompare(b.id))
  .map((item) => item.id);
