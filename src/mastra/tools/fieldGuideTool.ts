/**
 * Roam - Field guide lookup.
 * Keyword-scored retrieval over a small curated database. It is deliberately simple and
 * fully offline. The entries are a seed set: extend them with your region's species.
 */

export interface FieldGuideEntry {
  commonName: string;
  scientificName: string;
  category: "Flora" | "Fauna" | "Fungi";
  audioCue: string;
  fieldNote: string;
  edibleOrCaution?: string;
  keywords: string[];
}

const FIELD_DATABASE: FieldGuideEntry[] = [
  {
    commonName: "Sugar Maple",
    scientificName: "Acer saccharum",
    category: "Flora",
    audioCue: "Deep fiery orange and scarlet 5-lobed leaves",
    fieldNote: "The star of fall foliage. Look up at the canopy for brilliant orange crowns glowing in backlight.",
    edibleOrCaution: "Sap is boiled down to make maple syrup.",
    keywords: ["maple", "sugar", "fall", "foliage", "leaves", "red", "orange", "tree", "trees", "syrup", "canopy", "color", "colour", "autumn"],
  },
  {
    commonName: "White-breasted Nuthatch",
    scientificName: "Sitta carolinensis",
    category: "Fauna",
    audioCue: "Nasal 'yank-yank' call echoing off oak trunks",
    fieldNote: "Often seen walking head-first down tree trunks, probing bark for acorns and beetle larvae.",
    keywords: ["nuthatch", "bird", "birds", "call", "calls", "yank", "oak", "trunk", "tree", "head", "singing", "sing"],
  },
  {
    commonName: "Chanterelle Mushroom",
    scientificName: "Cantharellus cibarius",
    category: "Fungi",
    audioCue: "Golden-yellow ruffled cap smelling faintly of apricots",
    fieldNote: "Grows near mossy roots of hardwood trees. Look under fallen leaf litter.",
    edibleOrCaution: "Prized edible, but look-alike false chanterelles exist. Confirm in person with an expert before eating.",
    keywords: ["mushroom", "mushrooms", "fungi", "fungus", "edible", "forage", "foraging", "golden", "chanterelle", "moss"],
  },
  {
    commonName: "Black-capped Chickadee",
    scientificName: "Poecile atricapillus",
    category: "Fauna",
    audioCue: "Two-tone whistling 'fee-bee' followed by rapid 'chick-a-dee-dee-dee'",
    fieldNote: "Curious small birds that will perch within arm's length if you stand still.",
    keywords: ["bird", "birds", "song", "sing", "singing", "whistle", "whistling", "call", "calls", "chickadee", "tweet", "chirp"],
  },
  {
    commonName: "Red Oak",
    scientificName: "Quercus rubra",
    category: "Flora",
    audioCue: "Bristle-tipped leaves turning rich russet-brown",
    fieldNote: "Heavy acorn drops this season provide autumn forage for deer, squirrels, and black bears.",
    keywords: ["oak", "oaks", "acorn", "acorns", "tree", "trees", "leaves", "russet", "bronze", "bear", "deer"],
  },
  {
    commonName: "Eastern Bluebird",
    scientificName: "Sialia sialis",
    category: "Fauna",
    audioCue: "Soft, warbling 'chur-lee' notes from fence posts and open fields",
    fieldNote: "Perches on fence wires and dead snags in open country, dropping to the ground to take insects.",
    keywords: ["bluebird", "bird", "birds", "song", "sing", "singing", "call", "blue", "fence", "field", "open", "meadow"],
  },
  {
    commonName: "Pileated Woodpecker",
    scientificName: "Dryocopus pileatus",
    category: "Fauna",
    audioCue: "Loud, wild laughing call and deep drumming on dead trees",
    fieldNote: "Crow-sized woodpecker that carves rectangular holes in dead trunks while searching for carpenter ants.",
    keywords: ["woodpecker", "pileated", "drum", "drumming", "knock", "laugh", "laughing", "bird", "birds", "dead", "trunk", "call"],
  },
  {
    commonName: "Wild Leek (Ramp)",
    scientificName: "Allium tricoccum",
    category: "Flora",
    audioCue: "Broad smooth green leaves with a strong onion-garlic smell when crushed",
    fieldNote: "Grows in moist, rich hardwood forest in spring. The leaves die back by early summer.",
    edibleOrCaution: "Look-alikes include lily-of-the-valley, which is toxic. Identify by smell and leaf structure in person; never eat on identification from a chat alone.",
    keywords: ["ramp", "ramps", "leek", "wild", "onion", "garlic", "forage", "foraging", "edible", "leaves", "green", "spring"],
  },
];

const STOPWORDS = new Set([
  "the", "and", "for", "are", "that", "this", "what", "which", "where", "when", "how", "its", "it's",
  "with", "from", "near", "there", "these", "those", "can", "should", "does", "you", "your", "was",
  "have", "has", "not", "but", "any", "just", "about", "into", "over", "under", "is", "in", "on", "at",
  "to", "of", "my", "me", "i", "or", "be", "do", "a", "an",
]);

/** Score each entry by how many query words appear in its name, notes, sound cues, or keywords. */
export async function searchFieldGuide(query: string, limit = 3): Promise<FieldGuideEntry[]> {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  if (tokens.length === 0) return FIELD_DATABASE.slice(0, 2);

  const scored = FIELD_DATABASE.map((entry) => {
    const haystack = [
      entry.commonName,
      entry.scientificName,
      entry.audioCue,
      entry.fieldNote,
      ...entry.keywords,
    ]
      .join(" ")
      .toLowerCase();
    const score = tokens.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0);
    return { entry, score };
  });

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);

  return hits.length > 0 ? hits : FIELD_DATABASE.slice(0, 2);
}
