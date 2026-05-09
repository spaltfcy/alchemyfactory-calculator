import type { Machine } from '../types';

export const MACHINES: Machine[] = [
  {
    id: 'steam_boiler',
    name: {
      ja: '蒸気ボイラー',
      en: 'Steam Boiler'
    },
    category: 'steam',
    buildCost: [
      {
        itemId: 'steel_ingot',
        amount: 5
      },
      {
        itemId: 'glass',
        amount: 5
      }
    ],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 1
    }
  },
  {
    id: 'advanced_alembic',
    name: {
      ja: '上級アランビック',
      en: 'Advanced Alembic'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 2,
      liquidInputs: 1,
      solidOutputs: 0,
      liquidOutputs: 1
    },
    heatConsumptionPerSec: 270
  },
  {
    id: 'advanced_assembler',
    name: {
      ja: '上級アセンブラー',
      en: 'Advanced Assembler'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 3,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'advanced_athanor',
    name: {
      ja: '上級アタノール',
      en: 'Advanced Athanor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 3,
      liquidInputs: 1,
      solidOutputs: 3,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 360
  },
  {
    id: 'advanced_blender',
    name: {
      ja: '上級ブレンダー',
      en: 'Advanced Blender'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 2,
      liquidInputs: 1,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'advanced_shaper',
    name: {
      ja: '上級シェイパー',
      en: 'Advanced Shaper'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 5,
      liquidInputs: 1,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'alembic',
    name: {
      ja: 'アランビック',
      en: 'Alembic'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 1,
      solidOutputs: 0,
      liquidOutputs: 1
    },
    heatConsumptionPerSec: 108
  },
  {
    id: 'arcane_processor',
    name: {
      ja: '秘術プロセッサー',
      en: 'Arcane Processor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 3,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'arcane_shaper',
    name: {
      ja: '秘術シェイパー',
      en: 'Arcane Shaper'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 9,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'assembler',
    name: {
      ja: 'アセンブラー',
      en: 'Assembler'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 2,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'athanor',
    name: {
      ja: 'アタノール',
      en: 'Athanor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 2,
      liquidInputs: 0,
      solidOutputs: 2,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 32
  },
  {
    id: 'blender',
    name: {
      ja: 'ブレンダー',
      en: 'Blender'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 1,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'cauldron',
    name: {
      ja: '錬金釜',
      en: 'Cauldron'
    },
    category: 'production',
    buildCost: [
      {
        itemId: 'bronze_ingot',
        amount: 20
      }
    ],
    ports: {
      solidInputs: 3,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'crucible',
    name: {
      ja: 'るつぼ',
      en: 'Crucible'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 4
  },
  {
    id: 'extractor',
    name: {
      ja: '抽出機',
      en: 'Extractor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 1
    }
  },
  {
    id: 'grinder',
    name: {
      ja: 'グラインダー',
      en: 'Grinder'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'iron_smelter',
    name: {
      ja: '鉄製錬炉',
      en: 'Iron Smelter'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 2,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 9
  },
  {
    id: 'kiln',
    name: {
      ja: '窯',
      en: 'Kiln'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 15
  },
  {
    id: 'nursery',
    name: {
      ja: '苗床',
      en: 'Nursery'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 2,
      liquidOutputs: 0
    }
  },
  {
    id: 'paradox_crucible',
    name: {
      ja: 'パラドックスるつぼ',
      en: 'Paradox Crucible'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 1200
  },
  {
    id: 'processor',
    name: {
      ja: 'プロセッサー',
      en: 'Processor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'refiner',
    name: {
      ja: '精製機',
      en: 'Refiner'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'shaper',
    name: {
      ja: 'シェイパー',
      en: 'Shaper'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 4,
      liquidInputs: 0,
      solidOutputs: 1,
      liquidOutputs: 0
    }
  },
  {
    id: 'stone_crusher',
    name: {
      ja: 'ストーンクラッシャー',
      en: 'Stone Crusher'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 9,
      liquidOutputs: 0
    }
  },
  {
    id: 'table_saw',
    name: {
      ja: 'テーブルソー',
      en: 'Table Saw'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 1,
      liquidInputs: 0,
      solidOutputs: 2,
      liquidOutputs: 0
    }
  },
  {
    id: 'world_tree_nursery',
    name: {
      ja: '世界樹の苗床',
      en: 'World Tree Nursery'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 2,
      liquidOutputs: 0
    }
  },
  {
    id: 'stackable_crucible',
    name: {
      ja: 'stackable_crucible',
      en: 'stackable_crucible'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 6
  },
  {
    id: 'thermal_extractor',
    name: {
      ja: 'thermal_extractor',
      en: 'thermal_extractor'
    },
    category: 'production',
    buildCost: [],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 0
    },
    heatConsumptionPerSec: 80
  },
  {
    id: 'advanced_cauldron',
    name: {
      ja: '高性能錬金釜',
      en: 'Advanced Cauldron'
    },
    category: 'production',
    buildCost: [
      {
        itemId: 'silver_ingot',
        amount: 20
      }
    ],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 0
    }
  },
  {
    id: 'steam_heating_pad',
    name: {
      ja: '蒸気加熱パッド',
      en: 'Steam Heating Pad'
    },
    category: 'steam',
    buildCost: [
      {
        itemId: 'steel_ingot',
        amount: 3
      },
      {
        itemId: 'copper_ingot',
        amount: 3
      }
    ],
    ports: {
      solidInputs: 0,
      liquidInputs: 0,
      solidOutputs: 0,
      liquidOutputs: 0
    },
    internal: true
  },
];

export const machineById: Record<string, Machine> = Object.fromEntries(
  MACHINES.map((machine) => [machine.id, machine]),
);
