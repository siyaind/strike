"""Generate signing fixtures with the OFFICIAL hyperliquid-python-sdk (pip install hyperliquid-python-sdk).
The key below is a well-known throwaway test key (also used in the python SDK's own tests). Never fund it."""
import json, sys
import eth_account
from hyperliquid.utils.signing import sign_l1_action, sign_agent, order_request_to_order_wire, order_wires_to_order_action, action_hash
from hyperliquid.utils.types import Cloid
import hyperliquid

KEY = "0x0123456789012345678901234567890123456789012345678901234567890123"
w = eth_account.Account.from_key(KEY)
out = {"sdk": "hyperliquid-python-sdk", "sdkVersion": __import__('importlib.metadata').metadata.version('hyperliquid-python-sdk'), "address": w.address, "cases": []}

def l1(name, action, nonce, vault=None, expires=None):
    for env in ("testnet", "mainnet"):
        sig = sign_l1_action(w, action, vault, nonce, expires, env == "mainnet")
        out["cases"].append({"name": f"{name}:{env}", "kind": "l1", "env": env, "action": action, "nonce": nonce, "vault": vault, "expiresAfter": expires,
                             "hash": "0x" + action_hash(action, vault, nonce, expires).hex(), "sig": sig})

o1 = order_request_to_order_wire({"coin": "ETH", "is_buy": True, "sz": 0.0147, "limit_px": 1670.1, "reduce_only": False, "order_type": {"limit": {"tif": "Ioc"}}}, 4)
l1("order-ioc", order_wires_to_order_action([o1]), 1677777606040)
o2 = order_request_to_order_wire({"coin": "BTC", "is_buy": False, "sz": 0.001, "limit_px": 95000, "reduce_only": True, "order_type": {"trigger": {"triggerPx": 94000, "isMarket": True, "tpsl": "sl"}}, "cloid": Cloid.from_str("0x00000000000000000000000000000001")}, 3)
l1("order-trigger-cloid", order_wires_to_order_action([o2]), 1700000000000)
l1("cancel", {"type": "cancel", "cancels": [{"a": 3, "o": 123456}]}, 1700000000001)
l1("leverage", {"type": "updateLeverage", "asset": 3, "isCross": True, "leverage": 3}, 1700000000002)
l1("order-vault-expires", order_wires_to_order_action([o1]), 1700000000003, "0x1719884eb866cb12b2287399b15f7db5e7d775ea", 1700000600000)

agent = {"type": "approveAgent", "agentAddress": "0x5e9ee1089755c3435139848e47e6635505d5a13a", "agentName": "strike", "nonce": 1700000000004}
sig = sign_agent(w, dict(agent), False)
out["cases"].append({"name": "approveAgent:testnet", "kind": "approveAgent", "env": "testnet", "action": agent, "sig": sig})
json.dump(out, sys.stdout, indent=1)
