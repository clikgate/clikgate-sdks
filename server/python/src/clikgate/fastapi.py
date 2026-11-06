"""FastAPI add-on: the Starlette middleware and the ``click_id`` dependency (see :mod:`clikgate.starlette`).

Example::

    from clikgate.fastapi import ClikgateMiddleware, click_id
    app.add_middleware(ClikgateMiddleware, client=clikgate)
"""

from .starlette import ClikgateMiddleware, click_id, keep_endpoint

__all__ = ["ClikgateMiddleware", "click_id", "keep_endpoint"]
