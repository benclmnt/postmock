"""Runs one postmark-python example file, unmodified, against postmock.

postmark-python has no live suite (docs/08 §5.1). Its examples construct clients with placeholder
tokens and the default base URL, so this wrapper points both client classes at POSTMOCK_API_URL
and swaps the documented placeholder tokens for the conformance tokens before the example runs.
"""

import os
import runpy
import sys

from postmark.clients.account_client import AccountClient
from postmark.clients.server_client import ServerClient

PLACEHOLDERS = {
    "xxx-YOUR-SERVER-TOKEN-xxxx-xxxxxxx": os.environ["POSTMARK_SERVER_TOKEN"],
    "<YOUR POSTMARK SERVER TOKEN>": os.environ["POSTMARK_SERVER_TOKEN"],
    "xxx-YOUR-ACCOUNT-TOKEN-xxxx-xxxxxxx": os.environ["POSTMARK_ACCOUNT_TOKEN"],
}


def route(cls):
    # The sync clients wrap these classes and pass base_url=None (postmark/sync.py:135-138).
    cls._base_url = os.environ["POSTMOCK_API_URL"]
    original = cls.__init__

    def __init__(self, token, *args, **kwargs):
        original(self, PLACEHOLDERS.get(token, token), *args, **kwargs)

    cls.__init__ = __init__


route(ServerClient)
route(AccountClient)

example = sys.argv[1]
sys.argv = [example]
runpy.run_path(example, run_name="__main__")
