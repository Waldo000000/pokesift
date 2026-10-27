"""Build the bundled species index from PokeAPI's public CSV files (no scan API)."""
import csv, json, pathlib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path('/tmp/pokesift-species')
FILES = ['pokemon_species.csv', 'pokemon_species_names.csv', 'pokemon.csv', 'pokemon_types.csv', 'types.csv']
def rows(name):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/' + name, timeout=30).read())
    return list(csv.DictReader(path.open()))
def main():
    species = rows(FILES[0]); names = rows(FILES[1]); pokemon = rows(FILES[2]); memberships = rows(FILES[3]); types = {r['id']: r['identifier'].title() for r in rows(FILES[4])}
    defaults = {r['species_id']: r['id'] for r in pokemon if r['is_default'] == '1'}
    output = []
    for row in species:
        sid = row['id']; aliases = [r for r in names if r['pokemon_species_id'] == sid]
        english = next((r['name'] for r in aliases if r['local_language_id'] == '9'), row['identifier'].replace('-', ' ').title())
        output.append({'id':int(sid),'name':english,'aliases':sorted(set([row['identifier']] + [r['name'] for r in aliases])), 'family':int(row['evolution_chain_id']), 'parent':int(row['evolves_from_species_id']) if row['evolves_from_species_id'] else None, 'types':[types[r['type_id']] for r in memberships if r['pokemon_id'] == defaults.get(sid)]})
    (ROOT/'dist/species-index.js').write_text('// Names, types and evolution families: https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv\nwindow.POKESIFT_SPECIES='+json.dumps(output,ensure_ascii=False,separators=(',',':'))+';\n')
    print(f'Bundled {len(output)} species with multilingual aliases.')
if __name__ == '__main__': main()
