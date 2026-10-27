import unittest
from auth import mint_token, verify_token

class TokenTests(unittest.TestCase):
    def test_expiry_purpose_origin_and_rotation(self):
        invite=mint_token('long-test-password', 'invite', 'https://app.example', now=1000)
        self.assertTrue(verify_token(invite,'long-test-password','invite','https://app.example',now=1599))
        for password,kind,origin,now in [('long-test-password','invite','https://app.example',1600),('rotated-password','invite','https://app.example',1001),('long-test-password','session','https://app.example',1001),('long-test-password','invite','https://other.example',1001)]:
            self.assertIsNone(verify_token(invite,password,kind,origin,now=now))
        self.assertIsNone(verify_token(invite+'x','long-test-password','invite','https://app.example',now=1001))

    def test_sessions_survive_restart_and_expire(self):
        session=mint_token('long-test-password','session','https://app.example',now=1000)
        self.assertTrue(verify_token(session,'long-test-password','session','https://app.example',now=2592999))
        self.assertIsNone(verify_token(session,'long-test-password','session','https://app.example',now=2593000))
