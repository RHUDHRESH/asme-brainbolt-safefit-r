"""Real-time BSS operation layer (v2).

Adds the five capabilities the Tier-S literature supplies and the v1 batch
solver lacks: battery state transitions, charging-rate/degradation trade-off,
inventory management, electricity-market operation and demand uncertainty.

The v1 health core (integrity -> classify -> MAUT/TOPSIS) is reused unchanged;
this package wraps it in a closed-loop, rolling-horizon station simulator.
"""

__all__ = [
    "config_rt",
    "states",
    "degradation",
    "market",
    "uncertainty",
    "charging",
    "allocator",
    "simulator",
]
