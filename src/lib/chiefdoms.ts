/**
 * The chiefdoms of each district, after the 2017 reorganisation: 190 in all. Taken from
 * Wikipedia's "Chiefdoms of Sierra Leone" (post-2017 tables), with the six city and town
 * councils left out. To be checked by Karim.
 *
 * Plain data with no server imports: the booking form needs it in the browser too. Stored as the
 * name itself, so a request keeps reading right if the list is ever corrected.
 */
export const CHIEFDOMS: Record<string, readonly string[]> = {
  "Bo": ["Badjia", "Bagbo", "Bagbwe", "Baoma", "Bongor", "Bumpe–Gao", "Gbo", "Jaiama", "Kakua", "Komboya", "Lugbu", "Niawa Lenga", "Selenga", "Tikonko", "Valunia", "Wonde"],
  "Bombali": ["Biriwa", "Bombali Shebora", "Bombali Siari", "Gbanti", "Gbendembu", "Kamaranka", "Magbaiamba Ndowahun", "Makari", "Mara", "Ngowahun", "Paki Massabong", "Safroko Limba"],
  "Bonthe": ["Bendu", "Bum", "Dema", "Imperri", "Jong", "Kpanda Kemo", "Kwamebai Krim", "Nongoba Bullom", "Sittia", "Sogbini", "Yawbeko"],
  "Falaba": ["Delemandugu", "Dembelia", "Dembelia Sikunia", "Folasaba", "Kamadu Yiraia", "Kebelia", "Kulor Saradu", "Mongo", "Morfindugu", "Neya", "Nyedu", "Sulima", "Wollay Barawa"],
  "Kailahun": ["Dea", "Jahn", "Jaluahun", "Jawei", "Kissi Kama", "Kissi Teng", "Kissi Tongi", "Luawa", "Malema", "Mandu", "Peje Bongre", "Peje West", "Penguia", "Upper Bambara", "Yawei"],
  "Kambia": ["Briama", "Dixing", "Gbinle", "Khonimakha", "Magbema", "Mambolo", "Masungbala", "Munu Thala", "Samu", "Tonko Limba"],
  "Karene": ["Buya", "Debia", "Gbanti", "Libeisaygahun-Gbombahun", "Mafonda Makerembay", "Romende", "Safroko", "Sanda Loko", "Sanda Magbolontor", "Sanda Tenraren", "Sella Limba", "Tambakha Simibungie", "Tambakha Yobangie"],
  "Kenema": ["Dama", "Dodo", "Gaura", "Gorama Mende", "Kandu Leppiam", "Koya", "Langurama Ya", "Lower Bambara", "Malegohun", "Niawa", "Nomo", "Nongowa", "Simbaru", "Small Bo", "Tunkia", "Wando"],
  "Koinadugu": ["Diang", "Gbonkobon Kayaka", "Kalian", "Kamukeh", "Kasunko KaKellian", "Nieni", "Sengbe", "Tamiso", "Wara-Wara Bafodia", "Wara-Wara Yagala"],
  "Kono": ["Fiama", "Gbane", "Gbane Kandor", "Gbense", "Gorama Kono", "Kamara", "Lei", "Mafindor", "Nimikoro", "Nimiyama", "Sandor", "Soa", "Tankoro", "Toli"],
  "Moyamba": ["Bagruwa", "Bumpe", "Dasse", "Fakunya", "Kagboro", "Kaiyamba", "Kamajei", "Kongbora", "Kori", "Kowa", "Lower Banta", "Ribbi", "Timdale", "Upper Banta"],
  "Port Loko": ["Bakeh Loko", "Bureh", "Kaffu Bullom", "Kamasondo", "Kaseh", "Koya", "Loko Massama", "Maconteh", "Maforki", "Makama", "Marampa", "Masimera", "Tinkatopa"],
  "Pujehun": ["Barri", "Gallines", "Kagonde", "Kpaka", "Kpanga", "Makpele", "Malen", "Mano Sakrim", "Panga Krim", "Peje", "Perri", "Soro Gbema", "Sowa", "Yekomo Kpukumu"],
  "Tonkolili": ["Dansogoia", "Gbonkolenken Masankong", "Kafe", "Kalanthuba", "Kholifa Mabang", "Kholifa Mamuntha Mayosso", "Kholifa Rowalla", "Kunike Barina", "Kunike Folawusu", "Kunike Sanda", "Malal", "Mayeppoh", "Poli", "Sambaia", "Simiria", "Tane", "Yele", "Yoni Mabanta", "Yoni Mamaila"],
};

/** The chiefdoms to choose from in a district: none in the Western Area. */
export const chiefdomsOf = (district: string): readonly string[] => CHIEFDOMS[district] ?? [];

/** Whether a chiefdom answer fits the district: required where there are chiefdoms, empty where not. */
export const chiefdomFits = (district: string, chiefdom: string) => {
  const list = chiefdomsOf(district);
  return list.length ? list.includes(chiefdom) : chiefdom === "";
};

/** "Kpaka, Pujehun District" style place line, with the chiefdom when there is one. */
export const placeLine = (village: string, chiefdom: string, district: string) =>
  [village, chiefdom ? `${chiefdom} Chiefdom` : "", district].filter(Boolean).join(", ");
