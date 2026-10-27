import unittest
from unittest.mock import MagicMock, Mock, patch

from pokemon_art import ArtworkCache, MAX_BYTES, fetch_artwork

PNG = b'\x89PNG\r\n\x1a\nfixture'


class ArtworkTests(unittest.TestCase):
    def test_only_bounded_species_ids_reach_fixed_public_host(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = PNG
        with patch('pokemon_art.urllib.request.build_opener') as build:
            build.return_value.open.return_value = response
            for value in ('https://example.com', '../25', '0', '1026', '025', '２５'):
                with self.assertRaises(ValueError):
                    fetch_artwork(value)
            build.assert_not_called()
            self.assertEqual(fetch_artwork('25'), PNG)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png')
            self.assertIsNone(request.get_header('Authorization'))
            response.read.assert_called_once_with(MAX_BYTES + 1)
            for invalid in (b'<html>error</html>', PNG + b'x' * MAX_BYTES):
                response.read.return_value = invalid
                with self.assertRaises(ValueError):
                    fetch_artwork('25')

    def test_cache_is_bounded_and_pauses_after_failure(self):
        fetch = Mock(return_value=PNG)
        cache = ArtworkCache(fetch)
        self.assertEqual(cache.get('25'), PNG)
        self.assertEqual(cache.get('25'), PNG)
        fetch.assert_called_once_with('25')
        for value in range(1, 60):
            cache.get(str(value))
        self.assertEqual(len(cache.items), 48)
        self.assertNotIn('1', cache.items)
        fetch.side_effect = OSError('Offline')
        with patch('pokemon_art.time.monotonic', return_value=100):
            with self.assertRaises(OSError):
                cache.get('225')
            count = fetch.call_count
            with self.assertRaises(RuntimeError):
                cache.get('226')
            self.assertEqual(fetch.call_count, count)
            self.assertEqual(cache.get('25'), PNG)
        fetch.side_effect = None
        with patch('pokemon_art.time.monotonic', return_value=131):
            self.assertEqual(cache.get('225'), PNG)


if __name__ == '__main__':
    unittest.main()
