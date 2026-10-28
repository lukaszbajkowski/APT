"""Powiadomienia push: zapis urządzenia, ogólna treść, powiadomienia o dokumencie i wiadomościach."""

from app import push

SUB = {"endpoint": "https://push.example.com/abc123", "keys": {"p256dh": "B" * 40, "auth": "a" * 16}}


def test_subscribe_and_test(admin_client):
    push.outbox = []
    assert len(admin_client.get("/api/push/key").json()["public_key"]) > 60
    assert admin_client.get("/api/push/status").json() == {"devices": 0}
    assert admin_client.post("/api/push/test").status_code == 400
    assert admin_client.post("/api/push/subscribe", json={**SUB, "endpoint": "http://zle"}).status_code == 400
    assert admin_client.post("/api/push/subscribe", json=SUB).status_code == 204
    assert admin_client.post("/api/push/subscribe", json=SUB).status_code == 204  # to samo urządzenie
    assert admin_client.get("/api/push/status").json() == {"devices": 1}
    assert admin_client.post("/api/push/test").json() == {"sent": 1}
    uid, title, _, url = push.outbox[-1]
    assert title == "Test powiadomień" and url == f"/?u={uid}"
    assert admin_client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]}).status_code == 204
    assert admin_client.get("/api/push/status").json() == {"devices": 0}
    push.outbox = None


def test_vapid_keys_are_stable(tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "data_dir", str(tmp_path))
    first = push.public_key()
    assert push.public_key() == first
    assert "PRIVATE" not in (tmp_path / "vapid.json").read_text()
