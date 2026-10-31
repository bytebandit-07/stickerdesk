export interface PokemonCardData {
  id: string;
  name: string;
  number: string;
  set: string;
  types?: string[];
  subtypes?: string[];
  supertype?: string;
  rarity?: string;
  images: {
    small: string;
    large: string;
  };
  foil?: string;
  mask?: string;
}
