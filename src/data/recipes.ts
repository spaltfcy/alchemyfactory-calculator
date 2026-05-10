import type { Recipe } from '../types';

export const RECIPES: Recipe[] = [
  {
    id: 'adamant',
    name: {
      ja: '金剛石',
      en: 'Adamant'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'polished_crystal',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'adamant',
        amount: 1
      }
    ]
  },
  {
    id: 'advanced_fertilizer',
    name: {
      ja: '上級肥料',
      en: 'Advanced Fertilizer'
    },
    machineId: 'assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'basic_fertilizer',
        amount: 1
      },
      {
        itemId: 'gloom_fungus',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'advanced_fertilizer',
        amount: 1
      }
    ]
  },
  {
    id: 'aqua_vitae',
    name: {
      ja: '生命の水',
      en: 'Aqua Vitae'
    },
    machineId: 'advanced_alembic',
    timeSec: 8,
    inputs: [
      {
        itemId: 'gentian_nectar',
        amount: 1
      },
      {
        itemId: 'world_tree_leaf',
        amount: 1
      },
      {
        itemId: 'brandy',
        amount: 200
      }
    ],
    outputs: [
      {
        itemId: 'aqua_vitae',
        amount: 10
      }
    ]
  },
  {
    id: 'bandage',
    name: {
      ja: '包帯',
      en: 'Bandage'
    },
    machineId: 'assembler',
    timeSec: 10,
    inputs: [
      {
        itemId: 'linen',
        amount: 1
      },
      {
        itemId: 'healing_potion',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'bandage',
        amount: 1
      }
    ]
  },
  {
    id: 'basic_fertilizer',
    name: {
      ja: '初級肥料',
      en: 'Basic Fertilizer'
    },
    machineId: 'assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'plant_ash',
        amount: 1
      },
      {
        itemId: 'quicklime_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'basic_fertilizer',
        amount: 1
      }
    ]
  },
  {
    id: 'black_powder',
    name: {
      ja: '火薬',
      en: 'Black Powder'
    },
    machineId: 'advanced_blender',
    timeSec: 12,
    inputs: [
      {
        itemId: 'sulfur_powder',
        amount: 1
      },
      {
        itemId: 'charcoal_powder',
        amount: 12
      },
      {
        itemId: 'limewater',
        amount: 150
      }
    ],
    outputs: [
      {
        itemId: 'black_powder',
        amount: 2
      }
    ]
  },
  {
    id: 'blast_potion',
    name: {
      ja: '爆発ポーション',
      en: 'Blast Potion'
    },
    machineId: 'advanced_blender',
    timeSec: 6,
    inputs: [
      {
        itemId: 'oblivion_essence',
        amount: 1
      },
      {
        itemId: 'black_powder',
        amount: 2
      },
      {
        itemId: 'brandy',
        amount: 40
      }
    ],
    outputs: [
      {
        itemId: 'blast_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'brandy',
    name: {
      ja: 'ブランデー',
      en: 'Brandy'
    },
    machineId: 'alembic',
    timeSec: 5,
    inputs: [
      {
        itemId: 'coke_powder',
        amount: 5
      },
      {
        itemId: 'fruit_wine',
        amount: 100
      }
    ],
    outputs: [
      {
        itemId: 'brandy',
        amount: 40
      }
    ]
  },
  {
    id: 'brick',
    name: {
      ja: 'レンガ',
      en: 'Brick'
    },
    machineId: 'kiln',
    timeSec: 6,
    inputs: [
      {
        itemId: 'clay',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'brick',
        amount: 1
      }
    ]
  },
  {
    id: 'brine',
    name: {
      ja: '塩水',
      en: 'Brine'
    },
    machineId: 'extractor',
    timeSec: 4,
    inputs: [
      {
        itemId: 'salt',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'brine',
        amount: 20
      }
    ]
  },
  {
    id: 'broken_shard',
    name: {
      ja: '破損チップ',
      en: 'Broken Shard'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'crude_shard',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'broken_shard',
        amount: 1
      }
    ]
  },
  {
    id: 'bronze_ingot',
    name: {
      ja: '青銅インゴット',
      en: 'Bronze Ingot'
    },
    machineId: 'crucible',
    timeSec: 12,
    inputs: [
      {
        itemId: 'impure_copper_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'bronze_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'bronze_rivet',
    name: {
      ja: '青銅リベット',
      en: 'Bronze Rivet'
    },
    machineId: 'processor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'bronze_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'bronze_rivet',
        amount: 3
      }
    ]
  },
  {
    id: 'chamomile',
    name: {
      ja: 'カモミール',
      en: 'Chamomile'
    },
    machineId: 'nursery',
    timeSec: 1120,
    inputs: [
      {
        itemId: 'chamomile_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'chamomile',
        amount: 140
      }
    ],
    nutrientInputPerRun: 100800,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'chamomile_powder',
    name: {
      ja: 'カモミールの粉末',
      en: 'Chamomile Powder'
    },
    machineId: 'grinder',
    timeSec: 3,
    inputs: [
      {
        itemId: 'chamomile',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'chamomile_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'charcoal_from_plank',
    name: {
      ja: '木炭',
      en: 'Charcoal'
    },
    machineId: 'crucible',
    timeSec: 4,
    inputs: [
      {
        itemId: 'plank',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'charcoal',
        amount: 1
      }
    ]
  },
  {
    id: 'charcoal_powder_from_charcoal',
    name: {
      ja: '木炭の粉末',
      en: 'Charcoal Powder'
    },
    machineId: 'grinder',
    timeSec: 4,
    inputs: [
      {
        itemId: 'charcoal',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'charcoal_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'clay',
    name: {
      ja: '粘土',
      en: 'Clay'
    },
    machineId: 'assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'charcoal_powder',
        amount: 2
      },
      {
        itemId: 'sand',
        amount: 4
      }
    ],
    outputs: [
      {
        itemId: 'clay',
        amount: 1
      }
    ]
  },
  {
    id: 'clay_powder',
    name: {
      ja: '粘土粉末',
      en: 'Clay Powder'
    },
    machineId: 'grinder',
    timeSec: 4,
    inputs: [
      {
        itemId: 'clay',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'clay_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'coal_from_coal_ore',
    name: {
      ja: '石炭',
      en: 'Coal'
    },
    machineId: 'stone_crusher',
    timeSec: 360,
    inputs: [
      {
        itemId: 'coal_ore',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'coal',
        amount: 120
      }
    ]
  },
  {
    id: 'coke',
    name: {
      ja: 'コークス',
      en: 'Coke'
    },
    machineId: 'crucible',
    timeSec: 6,
    inputs: [
      {
        itemId: 'coal',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'coke',
        amount: 1
      }
    ]
  },
  {
    id: 'coke_and_charcoal',
    name: {
      ja: 'コークスと木炭',
      en: 'Coke and Charcoal'
    },
    machineId: 'athanor',
    timeSec: 3,
    inputs: [
      {
        itemId: 'charcoal_powder',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'coke',
        amount: 1
      },
      {
        itemId: 'charcoal',
        amount: 2
      }
    ]
  },
  {
    id: 'coke_powder',
    name: {
      ja: 'コークス粉',
      en: 'Coke Powder'
    },
    machineId: 'grinder',
    timeSec: 12,
    inputs: [
      {
        itemId: 'coke',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'coke_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'copper_bearing',
    name: {
      ja: '銅ベアリング',
      en: 'Copper Bearing'
    },
    machineId: 'processor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'copper_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'copper_bearing',
        amount: 2
      }
    ]
  },
  {
    id: 'copper_coin',
    name: {
      ja: '銅貨',
      en: 'Copper Coin'
    },
    machineId: 'processor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'copper_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'copper_coin',
        amount: 300
      }
    ]
  },
  {
    id: 'copper_ingot',
    name: {
      ja: '銅インゴット',
      en: 'Copper Ingot'
    },
    machineId: 'crucible',
    timeSec: 12,
    inputs: [
      {
        itemId: 'copper_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'copper_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'copper_ingot_2',
    name: {
      ja: '銅インゴット',
      en: 'Copper Ingot 2'
    },
    machineId: 'kiln',
    timeSec: 12,
    inputs: [
      {
        itemId: 'copper_coin',
        amount: 400
      }
    ],
    outputs: [
      {
        itemId: 'copper_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'copper_powder',
    name: {
      ja: '銅粉',
      en: 'Copper Powder'
    },
    machineId: 'refiner',
    timeSec: 6,
    inputs: [
      {
        itemId: 'impure_copper_powder',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'copper_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'copper_powder_2',
    name: {
      ja: '銅粉',
      en: 'Copper Powder 2'
    },
    machineId: 'grinder',
    timeSec: 12,
    inputs: [
      {
        itemId: 'copper_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'copper_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'copper_powder_and_impure_copper_powder',
    name: {
      ja: '銅粉と不純銅粉',
      en: 'Copper Powder and Impure Copper Powder'
    },
    machineId: 'athanor',
    timeSec: 6,
    inputs: [
      {
        itemId: 'iron_sand',
        amount: 6
      },
      {
        itemId: 'soap_powder',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'copper_powder',
        amount: 1
      },
      {
        itemId: 'impure_copper_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'crown',
    name: {
      ja: '王冠',
      en: 'Crown'
    },
    machineId: 'advanced_assembler',
    timeSec: 15,
    inputs: [
      {
        itemId: 'gold_ingot',
        amount: 3
      },
      {
        itemId: 'ruby',
        amount: 1
      },
      {
        itemId: 'sapphire',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'crown',
        amount: 1
      }
    ]
  },
  {
    id: 'crude_crystal',
    name: {
      ja: '荒い晶石',
      en: 'Crude Crystal'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'shattered_crystal',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'crude_crystal',
        amount: 1
      }
    ]
  },
  {
    id: 'crude_shard',
    name: {
      ja: '粗悪なチップ',
      en: 'Crude Shard'
    },
    machineId: 'stone_crusher',
    timeSec: 480,
    inputs: [
      {
        itemId: 'quartz_ore',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'crude_shard',
        amount: 80
      }
    ]
  },
  {
    id: 'crude_shard_2',
    name: {
      ja: '粗悪なチップ',
      en: 'Crude Shard 2'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'fully_refined_sand',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'crude_shard',
        amount: 1
      }
    ]
  },
  {
    id: 'diamond',
    name: {
      ja: 'ダイヤモンド',
      en: 'Diamond'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'adamant',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'diamond',
        amount: 1
      }
    ]
  },
  {
    id: 'dull_shard',
    name: {
      ja: 'くすんだチップ',
      en: 'Dull Shard'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'broken_shard',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'dull_shard',
        amount: 1
      }
    ]
  },
  {
    id: 'emerald',
    name: {
      ja: 'エメラルド',
      en: 'Emerald'
    },
    machineId: 'cauldron',
    timeSec: 45.5,
    inputs: [
      {
        itemId: 'moonlit_soap',
        amount: 1
      },
      {
        itemId: 'lapis_lazuli',
        amount: 1
      },
      {
        itemId: 'fertile_catalyst',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'emerald',
        amount: 1
      }
    ]
  },
  {
    id: 'eternal_catalyst',
    name: {
      ja: '永遠の触媒',
      en: 'Eternal Catalyst'
    },
    machineId: 'arcane_processor',
    timeSec: 60,
    inputs: [
      {
        itemId: 'resonant_catalyst',
        amount: 15
      },
      {
        itemId: 'philosophers_stone',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'eternal_catalyst',
        amount: 1
      }
    ]
  },
  {
    id: 'fairy_dust',
    name: {
      ja: '精霊の粉末',
      en: 'Fairy Dust'
    },
    machineId: 'arcane_processor',
    timeSec: 4,
    inputs: [
      {
        itemId: 'chamomile_powder',
        amount: 1
      },
      {
        itemId: 'gentian_powder',
        amount: 1
      },
      {
        itemId: 'world_tree_leaf',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'fairy_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'fairy_tear',
    name: {
      ja: '精霊の涙',
      en: 'Fairy Tear'
    },
    machineId: 'extractor',
    timeSec: 4,
    inputs: [
      {
        itemId: 'fairy_dust',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'fairy_tear',
        amount: 1
      }
    ]
  },
  {
    id: 'fertile_catalyst',
    name: {
      ja: '豊穣の触媒',
      en: 'Fertile Catalyst'
    },
    machineId: 'advanced_blender',
    timeSec: 8,
    inputs: [
      {
        itemId: 'unstable_catalyst',
        amount: 1
      },
      {
        itemId: 'vitality_essence',
        amount: 1
      },
      {
        itemId: 'lavender_essential_oil',
        amount: 18
      }
    ],
    outputs: [
      {
        itemId: 'fertile_catalyst',
        amount: 1
      }
    ]
  },
  {
    id: 'flax',
    name: {
      ja: '亜麻',
      en: 'Flax'
    },
    machineId: 'nursery',
    timeSec: 400,
    inputs: [
      {
        itemId: 'flax_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'flax',
        amount: 200
      }
    ],
    nutrientInputPerRun: 4800,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'flax_fiber',
    name: {
      ja: '亜麻繊維',
      en: 'Flax Fiber'
    },
    machineId: 'grinder',
    timeSec: 3,
    inputs: [
      {
        itemId: 'flax',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'flax_fiber',
        amount: 1
      }
    ]
  },
  {
    id: 'fruit_wine',
    name: {
      ja: 'ベリー酒',
      en: 'Fruit Wine'
    },
    machineId: 'extractor',
    timeSec: 6,
    inputs: [
      {
        itemId: 'redcurrant',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'fruit_wine',
        amount: 10
      }
    ]
  },
  {
    id: 'fully_refined_sand',
    name: {
      ja: '完璧な精錬砂',
      en: 'Fully Refined Sand'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'refined_sand_5',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'fully_refined_sand',
        amount: 1
      }
    ]
  },
  {
    id: 'gentian_and_gentian_nectar',
    name: {
      ja: 'リンドウとリンドウの蜜',
      en: 'Gentian and Gentian Nectar'
    },
    machineId: 'nursery',
    timeSec: 2160,
    inputs: [
      {
        itemId: 'gentian_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gentian',
        amount: 80
      },
      {
        itemId: 'gentian_nectar',
        amount: 80
      }
    ],
    nutrientInputPerRun: 960000,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'gentian_powder',
    name: {
      ja: 'リンドウの粉末',
      en: 'Gentian Powder'
    },
    machineId: 'grinder',
    timeSec: 3,
    inputs: [
      {
        itemId: 'gentian',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gentian_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'glass',
    name: {
      ja: 'ガラス',
      en: 'Glass'
    },
    machineId: 'kiln',
    timeSec: 6,
    inputs: [
      {
        itemId: 'sand',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'glass',
        amount: 1
      }
    ]
  },
  {
    id: 'gloom_fungus_and_plank_from_rotten_log',
    name: {
      ja: '幽暗キノコと木材',
      en: 'Gloom Fungus and Plank'
    },
    machineId: 'table_saw',
    timeSec: 400,
    inputs: [
      {
        itemId: 'rotten_log',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gloom_fungus',
        amount: 40
      },
      {
        itemId: 'plank',
        amount: 160
      }
    ]
  },
  {
    id: 'gloom_spores',
    name: {
      ja: '幽暗胞子',
      en: 'Gloom Spores'
    },
    machineId: 'assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'gloom_fungus',
        amount: 2
      },
      {
        itemId: 'yeast_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gloom_spores',
        amount: 1
      }
    ]
  },
  {
    id: 'gold_coin',
    name: {
      ja: '金貨',
      en: 'Gold Coin'
    },
    machineId: 'processor',
    timeSec: 40,
    inputs: [
      {
        itemId: 'gold_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gold_coin',
        amount: 1
      }
    ]
  },
  {
    id: 'gold_dust',
    name: {
      ja: '砂金',
      en: 'Gold Dust'
    },
    machineId: 'refiner',
    timeSec: 10,
    inputs: [
      {
        itemId: 'impure_gold_dust',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'gold_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'gold_dust_and_impure_gold_dust',
    name: {
      ja: '砂金と不純砂金と粗悪な砂金',
      en: 'Gold Dust and Impure Gold Dust'
    },
    machineId: 'advanced_athanor',
    timeSec: 8,
    inputs: [
      {
        itemId: 'silver_powder',
        amount: 1
      },
      {
        itemId: 'volcanic_ash',
        amount: 1
      },
      {
        itemId: 'fertile_catalyst',
        amount: 1
      },
      {
        itemId: 'quicksilver',
        amount: 12
      }
    ],
    outputs: [
      {
        itemId: 'gold_dust',
        amount: 1
      },
      {
        itemId: 'impure_gold_dust',
        amount: 1
      },
      {
        itemId: 'crude_gold_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'gold_ingot',
    name: {
      ja: '金インゴット',
      en: 'Gold Ingot'
    },
    machineId: 'crucible',
    timeSec: 40,
    inputs: [
      {
        itemId: 'pure_gold_dust',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'gold_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'gold_ingot_2',
    name: {
      ja: '金インゴット',
      en: 'Gold Ingot 2'
    },
    machineId: 'kiln',
    timeSec: 40,
    inputs: [
      {
        itemId: 'gold_coin',
        amount: 3
      }
    ],
    outputs: [
      {
        itemId: 'gold_ingot',
        amount: 2
      }
    ]
  },
  {
    id: 'growth_potion',
    name: {
      ja: '成長ポーション',
      en: 'Growth Potion'
    },
    machineId: 'advanced_blender',
    timeSec: 6,
    inputs: [
      {
        itemId: 'chamomile_powder',
        amount: 2
      },
      {
        itemId: 'clay_powder',
        amount: 6
      },
      {
        itemId: 'brine',
        amount: 80
      }
    ],
    outputs: [
      {
        itemId: 'growth_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'healing_potion',
    name: {
      ja: '回復ポーション',
      en: 'Healing Potion'
    },
    machineId: 'assembler',
    timeSec: 6,
    inputs: [
      {
        itemId: 'sage_powder',
        amount: 6
      },
      {
        itemId: 'flax_fiber',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'healing_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'impure_gold_dust',
    name: {
      ja: '不純砂金',
      en: 'Impure Gold Dust'
    },
    machineId: 'refiner',
    timeSec: 10,
    inputs: [
      {
        itemId: 'crude_gold_dust',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'impure_gold_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'impure_silver_powder',
    name: {
      ja: '不純銀粉',
      en: 'Impure Silver Powder'
    },
    machineId: 'refiner',
    timeSec: 8,
    inputs: [
      {
        itemId: 'crude_silver_powder',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'impure_silver_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'iron_ingot',
    name: {
      ja: '鉄インゴット',
      en: 'Iron Ingot'
    },
    machineId: 'iron_smelter',
    timeSec: 600,
    inputs: [
      {
        itemId: 'iron_ore',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'iron_ingot',
        amount: 100
      }
    ]
  },
  {
    id: 'iron_ingot_2',
    name: {
      ja: '鉄インゴット',
      en: 'Iron Ingot 2'
    },
    machineId: 'crucible',
    timeSec: 6,
    inputs: [
      {
        itemId: 'iron_sand',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'iron_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'iron_nails',
    name: {
      ja: '鉄釘',
      en: 'Iron Nails'
    },
    machineId: 'processor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'iron_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'iron_nails',
        amount: 3
      }
    ]
  },
  {
    id: 'iron_sand',
    name: {
      ja: '砂鉄',
      en: 'Iron Sand'
    },
    machineId: 'grinder',
    timeSec: 30,
    inputs: [
      {
        itemId: 'iron_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'iron_sand',
        amount: 1
      }
    ]
  },
  {
    id: 'jupiter',
    name: {
      ja: '木星',
      en: 'Jupiter'
    },
    machineId: 'shaper',
    timeSec: 600,
    inputs: [
      {
        itemId: 'plank',
        amount: 1200
      },
      {
        itemId: 'small_wooden_gear',
        amount: 1800
      },
      {
        itemId: 'wooden_pulley',
        amount: 600
      }
    ],
    outputs: [
      {
        itemId: 'jupiter',
        amount: 1
      }
    ]
  },
  {
    id: 'lapis_lazuli_and_shattered_crystal',
    name: {
      ja: 'ラピスラズリと砕けた晶石と粗悪なチップ',
      en: 'Lapis Lazuli and Shattered Crystal'
    },
    machineId: 'advanced_athanor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'impure_silver_powder',
        amount: 1
      },
      {
        itemId: 'crude_shard',
        amount: 4
      },
      {
        itemId: 'gentian_powder',
        amount: 4
      }
    ],
    outputs: [
      {
        itemId: 'lapis_lazuli',
        amount: 1
      },
      {
        itemId: 'shattered_crystal',
        amount: 1
      },
      {
        itemId: 'crude_shard',
        amount: 1
      }
    ]
  },
  {
    id: 'large_wooden_gear',
    name: {
      ja: '木製の大歯車',
      en: 'Large Wooden Gear'
    },
    machineId: 'grinder',
    timeSec: 6,
    inputs: [
      {
        itemId: 'plank',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'large_wooden_gear',
        amount: 1
      }
    ]
  },
  {
    id: 'lavender',
    name: {
      ja: 'ラベンダー',
      en: 'Lavender'
    },
    machineId: 'nursery',
    timeSec: 1440,
    inputs: [
      {
        itemId: 'lavender_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'lavender',
        amount: 120
      }
    ],
    nutrientInputPerRun: 259200,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'lavender_essential_oil',
    name: {
      ja: 'ラベンダー精油',
      en: 'Lavender Essential Oil'
    },
    machineId: 'alembic',
    timeSec: 3,
    inputs: [
      {
        itemId: 'lavender',
        amount: 3
      },
      {
        itemId: 'linseed_oil',
        amount: 300
      }
    ],
    outputs: [
      {
        itemId: 'lavender_essential_oil',
        amount: 15
      }
    ]
  },
  {
    id: 'limewater',
    name: {
      ja: '石灰水',
      en: 'Limewater'
    },
    machineId: 'extractor',
    timeSec: 3,
    inputs: [
      {
        itemId: 'quicklime_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'limewater',
        amount: 30
      }
    ]
  },
  {
    id: 'linen',
    name: {
      ja: '麻布',
      en: 'Linen'
    },
    machineId: 'assembler',
    timeSec: 5,
    inputs: [
      {
        itemId: 'linen_thread',
        amount: 10
      }
    ],
    outputs: [
      {
        itemId: 'linen',
        amount: 1
      }
    ]
  },
  {
    id: 'linen_rope',
    name: {
      ja: '麻縄',
      en: 'Linen Rope'
    },
    machineId: 'processor',
    timeSec: 6,
    inputs: [
      {
        itemId: 'linen_thread',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'linen_rope',
        amount: 1
      }
    ]
  },
  {
    id: 'linen_thread',
    name: {
      ja: '麻糸',
      en: 'Linen Thread'
    },
    machineId: 'processor',
    timeSec: 3,
    inputs: [
      {
        itemId: 'flax_fiber',
        amount: 3
      }
    ],
    outputs: [
      {
        itemId: 'linen_thread',
        amount: 1
      }
    ]
  },
  {
    id: 'linseed_oil',
    name: {
      ja: '亜麻仁油',
      en: 'Linseed Oil'
    },
    machineId: 'extractor',
    timeSec: 2,
    inputs: [
      {
        itemId: 'flax',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'linseed_oil',
        amount: 50
      }
    ]
  },
  {
    id: 'luna',
    name: {
      ja: 'ルナ',
      en: 'Luna'
    },
    machineId: 'advanced_shaper',
    timeSec: 600,
    inputs: [
      {
        itemId: 'steel_ingot',
        amount: 75
      },
      {
        itemId: 'bronze_ingot',
        amount: 75
      },
      {
        itemId: 'copper_ingot',
        amount: 75
      },
      {
        itemId: 'silver_ingot',
        amount: 75
      },
      {
        itemId: 'gold_ingot',
        amount: 75
      },
      {
        itemId: 'moon_tear',
        amount: 75
      }
    ],
    outputs: [
      {
        itemId: 'luna',
        amount: 1
      }
    ]
  },
  {
    id: 'malachite_and_crude_shard',
    name: {
      ja: 'マラカイトと粗悪なチップ',
      en: 'Malachite and Crude Shard'
    },
    machineId: 'athanor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'impure_copper_powder',
        amount: 2
      },
      {
        itemId: 'clay_powder',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'malachite',
        amount: 1
      },
      {
        itemId: 'crude_shard',
        amount: 1
      }
    ]
  },
  {
    id: 'mars',
    name: {
      ja: '火星',
      en: 'Mars'
    },
    machineId: 'shaper',
    timeSec: 300,
    inputs: [
      {
        itemId: 'iron_nails',
        amount: 600
      },
      {
        itemId: 'steel_gear',
        amount: 300
      },
      {
        itemId: 'bronze_rivet',
        amount: 600
      },
      {
        itemId: 'copper_bearing',
        amount: 300
      }
    ],
    outputs: [
      {
        itemId: 'mars',
        amount: 1
      }
    ]
  },
  {
    id: 'mercury',
    name: {
      ja: '水星',
      en: 'Mercury'
    },
    machineId: 'advanced_shaper',
    timeSec: 600,
    inputs: [
      {
        itemId: 'turquoise',
        amount: 100
      },
      {
        itemId: 'malachite',
        amount: 100
      },
      {
        itemId: 'topaz',
        amount: 100
      },
      {
        itemId: 'obsidian',
        amount: 100
      },
      {
        itemId: 'lapis_lazuli',
        amount: 100
      },
      {
        itemId: 'quicksilver',
        amount: 1000
      }
    ],
    outputs: [
      {
        itemId: 'mercury',
        amount: 1
      }
    ]
  },
  {
    id: 'moon_tear',
    name: {
      ja: '月の涙',
      en: 'Moon Tear'
    },
    machineId: 'advanced_alembic',
    timeSec: 8,
    inputs: [
      {
        itemId: 'star_dust',
        amount: 16
      },
      {
        itemId: 'fairy_tear',
        amount: 10
      }
    ],
    outputs: [
      {
        itemId: 'moon_tear',
        amount: 1
      }
    ]
  },
  {
    id: 'moonlit_soap',
    name: {
      ja: '月光石鹸',
      en: 'Moonlit Soap'
    },
    machineId: 'blender',
    timeSec: 10,
    inputs: [
      {
        itemId: 'perfumed_soap_powder',
        amount: 2
      },
      {
        itemId: 'moon_tear',
        amount: 5
      }
    ],
    outputs: [
      {
        itemId: 'moonlit_soap',
        amount: 1
      }
    ]
  },
  {
    id: 'mortar',
    name: {
      ja: '乳鉢',
      en: 'Mortar'
    },
    machineId: 'processor',
    timeSec: 20,
    inputs: [
      {
        itemId: 'stone',
        amount: 5
      }
    ],
    outputs: [
      {
        itemId: 'mortar',
        amount: 1
      }
    ]
  },
  {
    id: 'oblivion_essence',
    name: {
      ja: '消滅エッセンス',
      en: 'Oblivion Essence'
    },
    machineId: 'paradox_crucible',
    timeSec: 8.7,
    inputs: [
      {
        itemId: 'sage_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'oblivion_essence',
        amount: 1
      }
    ]
  },
  {
    id: 'obsidian_and_volcanic_ash',
    name: {
      ja: '黒曜石と火山灰',
      en: 'Obsidian and Volcanic Ash'
    },
    machineId: 'advanced_athanor',
    timeSec: 6,
    inputs: [
      {
        itemId: 'oblivion_essence',
        amount: 1
      },
      {
        itemId: 'shattered_crystal',
        amount: 1
      },
      {
        itemId: 'unstable_catalyst',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'obsidian',
        amount: 1
      },
      {
        itemId: 'volcanic_ash',
        amount: 1
      }
    ]
  },
  {
    id: 'panacea_potion',
    name: {
      ja: '万能薬',
      en: 'Panacea Potion'
    },
    machineId: 'advanced_blender',
    timeSec: 6,
    inputs: [
      {
        itemId: 'fertile_catalyst',
        amount: 3
      },
      {
        itemId: 'blast_potion',
        amount: 3
      },
      {
        itemId: 'aqua_vitae',
        amount: 12
      }
    ],
    outputs: [
      {
        itemId: 'panacea_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'perfect_diamond',
    name: {
      ja: '完璧なダイヤモンド',
      en: 'Perfect Diamond'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'diamond',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'perfect_diamond',
        amount: 1
      }
    ]
  },
  {
    id: 'perfumed_soap',
    name: {
      ja: '香り石鹸',
      en: 'Perfumed Soap'
    },
    machineId: 'blender',
    timeSec: 8,
    inputs: [
      {
        itemId: 'soap_powder',
        amount: 4
      },
      {
        itemId: 'lavender_essential_oil',
        amount: 30
      }
    ],
    outputs: [
      {
        itemId: 'perfumed_soap',
        amount: 1
      }
    ]
  },
  {
    id: 'perfumed_soap_powder',
    name: {
      ja: '粉末香り石鹸',
      en: 'Perfumed Soap Powder'
    },
    machineId: 'grinder',
    timeSec: 8,
    inputs: [
      {
        itemId: 'perfumed_soap',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'perfumed_soap_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'philosophers_stone',
    name: {
      ja: '賢者の石',
      en: 'Philosophers Stone'
    },
    machineId: 'cauldron',
    timeSec: 60,
    inputs: [
      {
        itemId: 'ruby',
        amount: 1
      },
      {
        itemId: 'sapphire',
        amount: 1
      },
      {
        itemId: 'emerald',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'philosophers_stone',
        amount: 1
      }
    ]
  },
  {
    id: 'plank_from_logs',
    name: {
      ja: '木材',
      en: 'Plank'
    },
    machineId: 'table_saw',
    timeSec: 400,
    inputs: [
      {
        itemId: 'logs',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'plank',
        amount: 200
      }
    ]
  },
  {
    id: 'plant_ash',
    name: {
      ja: '草木灰',
      en: 'Plant Ash'
    },
    machineId: 'crucible',
    timeSec: 3,
    inputs: [
      {
        itemId: 'sage',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'plant_ash',
        amount: 1
      }
    ]
  },
  {
    id: 'pocket_watch',
    name: {
      ja: '懐中時計',
      en: 'Pocket Watch'
    },
    machineId: 'advanced_assembler',
    timeSec: 12,
    inputs: [
      {
        itemId: 'steel_gear',
        amount: 2
      },
      {
        itemId: 'copper_bearing',
        amount: 2
      },
      {
        itemId: 'glass',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'pocket_watch',
        amount: 1
      }
    ]
  },
  {
    id: 'polished_crystal',
    name: {
      ja: '研磨晶石',
      en: 'Polished Crystal'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'crude_crystal',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'polished_crystal',
        amount: 1
      }
    ]
  },
  {
    id: 'pure_gold_dust',
    name: {
      ja: '純粋砂金',
      en: 'Pure Gold Dust'
    },
    machineId: 'refiner',
    timeSec: 10,
    inputs: [
      {
        itemId: 'gold_dust',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'pure_gold_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'pure_gold_dust_2',
    name: {
      ja: '純粋砂金',
      en: 'Pure Gold Dust 2'
    },
    machineId: 'grinder',
    timeSec: 40,
    inputs: [
      {
        itemId: 'gold_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'pure_gold_dust',
        amount: 1
      }
    ]
  },
  {
    id: 'quicklime',
    name: {
      ja: '生石灰',
      en: 'Quicklime'
    },
    machineId: 'crucible',
    timeSec: 9,
    inputs: [
      {
        itemId: 'stone',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'quicklime',
        amount: 1
      }
    ]
  },
  {
    id: 'quicklime_powder',
    name: {
      ja: '石灰粉',
      en: 'Quicklime Powder'
    },
    machineId: 'grinder',
    timeSec: 9,
    inputs: [
      {
        itemId: 'quicklime',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'quicklime_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'quicksilver',
    name: {
      ja: '水銀',
      en: 'Quicksilver'
    },
    machineId: 'advanced_alembic',
    timeSec: 8,
    inputs: [
      {
        itemId: 'crude_silver_powder',
        amount: 1
      },
      {
        itemId: 'vitality_essence',
        amount: 1
      },
      {
        itemId: 'sulfuric_acid',
        amount: 80
      }
    ],
    outputs: [
      {
        itemId: 'quicksilver',
        amount: 10
      }
    ]
  },
  {
    id: 'redcurrant',
    name: {
      ja: 'レッドカラント',
      en: 'Redcurrant'
    },
    machineId: 'nursery',
    timeSec: 900,
    inputs: [
      {
        itemId: 'redcurrant_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'redcurrant',
        amount: 150
      }
    ],
    nutrientInputPerRun: 21600,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'refined_sand_1',
    name: {
      ja: '精錬砂1',
      en: 'Refined Sand 1'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'sand',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'refined_sand_1',
        amount: 1
      }
    ]
  },
  {
    id: 'refined_sand_2',
    name: {
      ja: '精錬砂2',
      en: 'Refined Sand 2'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'refined_sand_1',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'refined_sand_2',
        amount: 1
      }
    ]
  },
  {
    id: 'refined_sand_3',
    name: {
      ja: '精錬砂3',
      en: 'Refined Sand 3'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'refined_sand_2',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'refined_sand_3',
        amount: 1
      }
    ]
  },
  {
    id: 'refined_sand_4',
    name: {
      ja: '精錬砂4',
      en: 'Refined Sand 4'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'refined_sand_3',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'refined_sand_4',
        amount: 1
      }
    ]
  },
  {
    id: 'refined_sand_5',
    name: {
      ja: '精錬砂5',
      en: 'Refined Sand 5'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'refined_sand_4',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'refined_sand_5',
        amount: 1
      }
    ]
  },
  {
    id: 'resonant_catalyst',
    name: {
      ja: '共振触媒',
      en: 'Resonant Catalyst'
    },
    machineId: 'advanced_blender',
    timeSec: 8,
    inputs: [
      {
        itemId: 'fertile_catalyst',
        amount: 1
      },
      {
        itemId: 'volcanic_ash',
        amount: 1
      },
      {
        itemId: 'aqua_vitae',
        amount: 12
      }
    ],
    outputs: [
      {
        itemId: 'resonant_catalyst',
        amount: 1
      }
    ]
  },
  {
    id: 'ruby',
    name: {
      ja: 'ルビー',
      en: 'Ruby'
    },
    machineId: 'cauldron',
    timeSec: 30.9,
    inputs: [
      {
        itemId: 'diamond',
        amount: 1
      },
      {
        itemId: 'pure_gold_dust',
        amount: 1
      },
      {
        itemId: 'resonant_catalyst',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'ruby',
        amount: 1
      }
    ]
  },
  {
    id: 'sage',
    name: {
      ja: 'セージ',
      en: 'Sage'
    },
    machineId: 'nursery',
    timeSec: 540,
    inputs: [
      {
        itemId: 'sage_seeds',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sage',
        amount: 180
      }
    ],
    nutrientInputPerRun: 6480,
    nutrientRunRateMode: 'logisticsCap'
  },
  {
    id: 'sage_powder',
    name: {
      ja: 'セージの粉末',
      en: 'Sage Powder'
    },
    machineId: 'grinder',
    timeSec: 3,
    inputs: [
      {
        itemId: 'sage',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sage_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'salt_and_sand',
    name: {
      ja: '塩と砂',
      en: 'Salt and Sand'
    },
    machineId: 'stone_crusher',
    timeSec: 600,
    inputs: [
      {
        itemId: 'rock_salt',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'salt',
        amount: 100
      },
      {
        itemId: 'sand',
        amount: 100
      }
    ]
  },
  {
    id: 'salt_and_sand_2',
    name: {
      ja: '塩と砂',
      en: 'Salt and Sand 2'
    },
    machineId: 'athanor',
    timeSec: 6,
    inputs: [
      {
        itemId: 'charcoal_powder',
        amount: 2
      },
      {
        itemId: 'quicklime_powder',
        amount: 4
      }
    ],
    outputs: [
      {
        itemId: 'salt',
        amount: 1
      },
      {
        itemId: 'sand',
        amount: 6
      }
    ]
  },
  {
    id: 'sand',
    name: {
      ja: '砂',
      en: 'Sand'
    },
    machineId: 'grinder',
    timeSec: 12,
    inputs: [
      {
        itemId: 'stone',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sand',
        amount: 1
      }
    ]
  },
  {
    id: 'sapphire',
    name: {
      ja: 'サファイア',
      en: 'Sapphire'
    },
    machineId: 'cauldron',
    timeSec: 38.2,
    inputs: [
      {
        itemId: 'perfect_diamond',
        amount: 1
      },
      {
        itemId: 'world_tree_core',
        amount: 1
      },
      {
        itemId: 'unstable_catalyst',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sapphire',
        amount: 1
      }
    ]
  },
  {
    id: 'saturn',
    name: {
      ja: '土星',
      en: 'Saturn'
    },
    machineId: 'shaper',
    timeSec: 300,
    inputs: [
      {
        itemId: 'salt',
        amount: 600
      },
      {
        itemId: 'brick',
        amount: 600
      },
      {
        itemId: 'glass',
        amount: 600
      }
    ],
    outputs: [
      {
        itemId: 'saturn',
        amount: 1
      }
    ]
  },
  {
    id: 'shattered_crystal',
    name: {
      ja: '砕けた晶石',
      en: 'Shattered Crystal'
    },
    machineId: 'refiner',
    timeSec: 3,
    inputs: [
      {
        itemId: 'dull_shard',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'shattered_crystal',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_amulet',
    name: {
      ja: '銀の護符',
      en: 'Silver Amulet'
    },
    machineId: 'assembler',
    timeSec: 10,
    inputs: [
      {
        itemId: 'silver_ingot',
        amount: 2
      },
      {
        itemId: 'lapis_lazuli',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'silver_amulet',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_coin',
    name: {
      ja: '銀貨',
      en: 'Silver Coin'
    },
    machineId: 'processor',
    timeSec: 16,
    inputs: [
      {
        itemId: 'silver_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'silver_coin',
        amount: 5
      }
    ]
  },
  {
    id: 'silver_ingot',
    name: {
      ja: '銀インゴット',
      en: 'Silver Ingot'
    },
    machineId: 'crucible',
    timeSec: 16,
    inputs: [
      {
        itemId: 'silver_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'silver_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_ingot_2',
    name: {
      ja: '銀インゴット',
      en: 'Silver Ingot 2'
    },
    machineId: 'kiln',
    timeSec: 16,
    inputs: [
      {
        itemId: 'silver_coin',
        amount: 6
      }
    ],
    outputs: [
      {
        itemId: 'silver_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_powder',
    name: {
      ja: '銀粉',
      en: 'Silver Powder'
    },
    machineId: 'refiner',
    timeSec: 8,
    inputs: [
      {
        itemId: 'impure_silver_powder',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'silver_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_powder_2',
    name: {
      ja: '銀粉',
      en: 'Silver Powder 2'
    },
    machineId: 'grinder',
    timeSec: 16,
    inputs: [
      {
        itemId: 'silver_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'silver_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'silver_powder_and_crude_silver_powder',
    name: {
      ja: '銀粉と粗悪な銀粉',
      en: 'Silver Powder and Crude Silver Powder'
    },
    machineId: 'advanced_athanor',
    timeSec: 6.4,
    inputs: [
      {
        itemId: 'copper_powder',
        amount: 2
      },
      {
        itemId: 'unstable_catalyst',
        amount: 2
      },
      {
        itemId: 'black_powder',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'silver_powder',
        amount: 1
      },
      {
        itemId: 'crude_silver_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'small_wooden_gear',
    name: {
      ja: '木製の小歯車',
      en: 'Small Wooden Gear'
    },
    machineId: 'processor',
    timeSec: 12,
    inputs: [
      {
        itemId: 'large_wooden_gear',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'small_wooden_gear',
        amount: 3
      }
    ]
  },
  {
    id: 'soap',
    name: {
      ja: '石鹸',
      en: 'Soap'
    },
    machineId: 'blender',
    timeSec: 3,
    inputs: [
      {
        itemId: 'plant_ash',
        amount: 3
      },
      {
        itemId: 'linseed_oil',
        amount: 200
      }
    ],
    outputs: [
      {
        itemId: 'soap',
        amount: 1
      }
    ]
  },
  {
    id: 'soap_powder',
    name: {
      ja: '粉末石鹸',
      en: 'Soap Powder'
    },
    machineId: 'grinder',
    timeSec: 6,
    inputs: [
      {
        itemId: 'soap',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'soap_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'sol',
    name: {
      ja: 'ソル',
      en: 'Sol'
    },
    machineId: 'arcane_shaper',
    timeSec: 300,
    inputs: [
      {
        itemId: 'jupiter',
        amount: 1
      },
      {
        itemId: 'saturn',
        amount: 1
      },
      {
        itemId: 'mars',
        amount: 1
      },
      {
        itemId: 'venus',
        amount: 1
      },
      {
        itemId: 'mercury',
        amount: 1
      },
      {
        itemId: 'luna',
        amount: 1
      },
      {
        itemId: 'perfect_diamond',
        amount: 25
      },
      {
        itemId: 'eternal_catalyst',
        amount: 5
      },
      {
        itemId: 'world_tree_core',
        amount: 5
      }
    ],
    outputs: [
      {
        itemId: 'sol',
        amount: 1
      }
    ]
  },
  {
    id: 'star_dust',
    name: {
      ja: '星の砂',
      en: 'Star Dust'
    },
    machineId: 'arcane_processor',
    timeSec: 300,
    inputs: [
      {
        itemId: 'jupiter',
        amount: 1
      },
      {
        itemId: 'saturn',
        amount: 1
      },
      {
        itemId: 'mars',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'star_dust',
        amount: 50
      }
    ]
  },
  {
    id: 'steel_gear',
    name: {
      ja: '鋼の歯車',
      en: 'Steel Gear'
    },
    machineId: 'processor',
    timeSec: 16,
    inputs: [
      {
        itemId: 'steel_ingot',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'steel_gear',
        amount: 1
      }
    ]
  },
  {
    id: 'steel_ingot_and_iron_ingot',
    name: {
      ja: '鋼インゴットと鉄インゴット',
      en: 'Steel Ingot and Iron Ingot'
    },
    machineId: 'athanor',
    timeSec: 4,
    inputs: [
      {
        itemId: 'iron_ingot',
        amount: 1
      },
      {
        itemId: 'coke_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'steel_ingot',
        amount: 1
      },
      {
        itemId: 'iron_ingot',
        amount: 1
      }
    ]
  },
  {
    id: 'stone',
    name: {
      ja: '砕石',
      en: 'Stone'
    },
    machineId: 'stone_crusher',
    timeSec: 450,
    inputs: [
      {
        itemId: 'limestone',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'stone',
        amount: 150
      }
    ]
  },
  {
    id: 'stone_and_coal',
    name: {
      ja: '砕石と石炭と砂鉄など',
      en: 'Stone and Coal'
    },
    machineId: 'stone_crusher',
    timeSec: 3000,
    inputs: [
      {
        itemId: 'meteorite',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'stone',
        amount: 300
      },
      {
        itemId: 'coal',
        amount: 300
      },
      {
        itemId: 'iron_sand',
        amount: 300
      },
      {
        itemId: 'shattered_crystal',
        amount: 60
      },
      {
        itemId: 'obsidian',
        amount: 30
      },
      {
        itemId: 'adamant',
        amount: 7
      },
      {
        itemId: 'ruby',
        amount: 1
      },
      {
        itemId: 'sapphire',
        amount: 1
      },
      {
        itemId: 'emerald',
        amount: 1
      }
    ]
  },
  {
    id: 'sulfur_and_iron_ingot',
    name: {
      ja: '硫黄と鉄インゴット',
      en: 'Sulfur and Iron Ingot'
    },
    machineId: 'iron_smelter',
    timeSec: 960,
    inputs: [
      {
        itemId: 'pyrite_ore',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sulfur',
        amount: 40
      },
      {
        itemId: 'iron_ingot',
        amount: 120
      }
    ]
  },
  {
    id: 'sulfur_powder',
    name: {
      ja: '硫黄粉',
      en: 'Sulfur Powder'
    },
    machineId: 'grinder',
    timeSec: 6,
    inputs: [
      {
        itemId: 'sulfur',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'sulfur_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'sulfuric_acid',
    name: {
      ja: '硫酸',
      en: 'Sulfuric Acid'
    },
    machineId: 'alembic',
    timeSec: 4,
    inputs: [
      {
        itemId: 'sulfur_powder',
        amount: 1
      },
      {
        itemId: 'brine',
        amount: 60
      }
    ],
    outputs: [
      {
        itemId: 'sulfuric_acid',
        amount: 20
      }
    ]
  },
  {
    id: 'topaz',
    name: {
      ja: 'トパーズ',
      en: 'Topaz'
    },
    machineId: 'blender',
    timeSec: 12,
    inputs: [
      {
        itemId: 'crude_shard',
        amount: 1
      },
      {
        itemId: 'sulfuric_acid',
        amount: 30
      }
    ],
    outputs: [
      {
        itemId: 'topaz',
        amount: 1
      }
    ]
  },
  {
    id: 'transformation_potion',
    name: {
      ja: '変化ポーション',
      en: 'Transformation Potion'
    },
    machineId: 'assembler',
    timeSec: 6,
    inputs: [
      {
        itemId: 'coke_powder',
        amount: 2
      },
      {
        itemId: 'gloom_spores',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'transformation_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'turquoise',
    name: {
      ja: 'ターコイズ',
      en: 'Turquoise'
    },
    machineId: 'assembler',
    timeSec: 12,
    inputs: [
      {
        itemId: 'healing_potion',
        amount: 2
      },
      {
        itemId: 'sand',
        amount: 12
      }
    ],
    outputs: [
      {
        itemId: 'turquoise',
        amount: 1
      }
    ]
  },
  {
    id: 'unstable_catalyst',
    name: {
      ja: '不安定な触媒',
      en: 'Unstable Catalyst'
    },
    machineId: 'advanced_assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'chamomile_powder',
        amount: 1
      },
      {
        itemId: 'gloom_spores',
        amount: 1
      },
      {
        itemId: 'sulfur_powder',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'unstable_catalyst',
        amount: 1
      }
    ]
  },
  {
    id: 'venus',
    name: {
      ja: '金星',
      en: 'Venus'
    },
    machineId: 'advanced_shaper',
    timeSec: 1200,
    inputs: [
      {
        itemId: 'healing_potion',
        amount: 200
      },
      {
        itemId: 'vitality_potion',
        amount: 200
      },
      {
        itemId: 'transformation_potion',
        amount: 200
      },
      {
        itemId: 'growth_potion',
        amount: 200
      },
      {
        itemId: 'blast_potion',
        amount: 200
      },
      {
        itemId: 'sulfuric_acid',
        amount: 4000
      }
    ],
    outputs: [
      {
        itemId: 'venus',
        amount: 1
      }
    ]
  },
  {
    id: 'vitality_essence',
    name: {
      ja: '生命のエッセンス',
      en: 'Vitality Essence'
    },
    machineId: 'paradox_crucible',
    timeSec: 5.1,
    inputs: [
      {
        itemId: 'oblivion_essence',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'vitality_essence',
        amount: 1
      }
    ]
  },
  {
    id: 'vitality_potion',
    name: {
      ja: '活力ポーション',
      en: 'Vitality Potion'
    },
    machineId: 'blender',
    timeSec: 8,
    inputs: [
      {
        itemId: 'quicklime_powder',
        amount: 4
      },
      {
        itemId: 'fruit_wine',
        amount: 80
      }
    ],
    outputs: [
      {
        itemId: 'vitality_potion',
        amount: 1
      }
    ]
  },
  {
    id: 'volcanic_ash',
    name: {
      ja: '火山灰',
      en: 'Volcanic Ash'
    },
    machineId: 'grinder',
    timeSec: 24,
    inputs: [
      {
        itemId: 'obsidian',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'volcanic_ash',
        amount: 1
      }
    ]
  },
  {
    id: 'wooden_pulley',
    name: {
      ja: '木製滑車',
      en: 'Wooden Pulley'
    },
    machineId: 'assembler',
    timeSec: 4,
    inputs: [
      {
        itemId: 'plank',
        amount: 2
      },
      {
        itemId: 'linen_rope',
        amount: 1
      }
    ],
    outputs: [
      {
        itemId: 'wooden_pulley',
        amount: 1
      }
    ]
  },
  {
    id: 'world_tree_leaf_and_world_tree_core',
    name: {
      ja: '世界樹の葉と世界樹の核',
      en: 'World Tree Leaf and World Tree Core'
    },
    machineId: 'world_tree_nursery',
    timeSec: 300,
    inputs: [],
    outputs: [
      {
        itemId: 'world_tree_leaf',
        amount: 99
      },
      {
        itemId: 'world_tree_core',
        amount: 1
      }
    ],
    nutrientInputPerRun: 6000000,
    nutrientRunRateMode: 'fixedTime'
  },
  {
    id: 'yeast_powder',
    name: {
      ja: '酵母粉末',
      en: 'Yeast Powder'
    },
    machineId: 'blender',
    timeSec: 4,
    inputs: [
      {
        itemId: 'soap_powder',
        amount: 2
      },
      {
        itemId: 'fruit_wine',
        amount: 40
      }
    ],
    outputs: [
      {
        itemId: 'yeast_powder',
        amount: 1
      }
    ]
  },
  {
    id: 'clockwork_bird',
    name: {
      ja: 'ゼンマイ鳥',
      en: 'Clockwork Bird'
    },
    machineId: 'advanced_assembler',
    timeSec: 12,
    inputs: [
      {
        itemId: 'steel_ingot',
        amount: 6
      },
      {
        itemId: 'steel_gear',
        amount: 2
      },
      {
        itemId: 'malachite',
        amount: 2
      }
    ],
    outputs: [
      {
        itemId: 'clockwork_bird',
        amount: 1
      }
    ]
  },
  {
    id: 'steam_boiler_low',
    name: {
      ja: '蒸気ボイラー（低）',
      en: 'Steam Boiler (Low)'
    },
    machineId: 'steam_boiler',
    timeSec: 60,
    inputs: [],
    outputs: [
      {
        itemId: 'steam',
        amount: 675
      }
    ],
    heatInputPerSec: 225,
    internal: true
  },
  {
    id: 'steam_boiler_medium',
    name: {
      ja: '蒸気ボイラー（中）',
      en: 'Steam Boiler (Medium)'
    },
    machineId: 'steam_boiler',
    timeSec: 60,
    inputs: [],
    outputs: [
      {
        itemId: 'steam',
        amount: 3375
      }
    ],
    heatInputPerSec: 1125,
    internal: true
  },
  {
    id: 'steam_boiler_high',
    name: {
      ja: '蒸気ボイラー（高）',
      en: 'Steam Boiler (High)'
    },
    machineId: 'steam_boiler',
    timeSec: 60,
    inputs: [],
    outputs: [
      {
        itemId: 'steam',
        amount: 20250
      }
    ],
    heatInputPerSec: 6750,
    internal: true
  },
];

export const recipeById: Record<string, Recipe> = Object.fromEntries(
  RECIPES.map((recipe) => [recipe.id, recipe]),
);

export const RECIPE_ORDER: Record<string, number> = Object.fromEntries(
  RECIPES.map((recipe, index) => [recipe.id, recipe.order ?? index]),
);

const recipesProducingByItemId: Record<string, Recipe[]> = {};
for (const recipe of RECIPES) {
  for (const output of recipe.outputs) {
    const group = recipesProducingByItemId[output.itemId] ?? [];
    group.push(recipe);
    recipesProducingByItemId[output.itemId] = group;
  }
}

for (const group of Object.values(recipesProducingByItemId)) {
  group.sort((a, b) => (RECIPE_ORDER[a.id] ?? 999999) - (RECIPE_ORDER[b.id] ?? 999999) || a.id.localeCompare(b.id));
}

export const DEFAULT_RECIPE_BY_ITEM_ID: Record<string, string> = Object.fromEntries(
  Object.entries(recipesProducingByItemId).map(([itemId, recipes]) => [itemId, recipes[0]?.id ?? '']),
);

export function getRecipesProducing(itemId: string): Recipe[] {
  return recipesProducingByItemId[itemId] ?? [];
}
