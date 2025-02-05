import pytest
from hola_cli.test_utils.fakes.api_client import FakeApiClient, FakeResponse


def test_fake_api_client_initialization():
    client = FakeApiClient()
    assert not client.responses
    assert not client.request_history
    assert client.default_response is None


def test_fake_api_client_set_response():
    client = FakeApiClient()
    client.set_response("GET", "/test", {"data": "test_data"}, 200)

    assert "GET" in client.responses
    assert "/test" in client.responses["GET"]
    response_obj = client.responses["GET"]["/test"]
    assert isinstance(response_obj, FakeResponse)
    assert response_obj.status_code == 200
    assert response_obj.data == {"data": "test_data"}
    assert response_obj.text == '{"data": "test_data"}'  # Default JSON stringification


def test_fake_api_client_set_response_with_text_and_headers():
    client = FakeApiClient()
    headers = {"X-Custom-Header": "value"}
    client.set_response(
        "POST",
        "/submit",
        {"id": 1},
        201,
        response_text="Created",
        response_headers=headers,
    )

    response_obj = client.responses["POST"]["/submit"]
    assert response_obj.status_code == 201
    assert response_obj.data == {"id": 1}
    assert response_obj.text == "Created"
    assert response_obj.headers == headers


def test_fake_api_client_set_default_response():
    client = FakeApiClient()
    client.set_default_response({"message": "default"}, 418)

    assert client.default_response is not None
    assert client.default_response.status_code == 418
    assert client.default_response.data == {"message": "default"}


def test_fake_api_client_sync_detailed_specific_response():
    client = FakeApiClient()
    client.set_response("GET", "/specific", {"found": True}, 200)

    response = client.sync_detailed("GET", "/specific")
    assert response.status_code == 200
    assert response.data == {"found": True}

    assert len(client.request_history) == 1
    request = client.request_history[0]
    assert request["method"] == "GET"
    assert request["url"] == "/specific"


def test_fake_api_client_sync_detailed_uses_default_response():
    client = FakeApiClient()
    client.set_default_response({"default_payload": True}, 202)
    client.set_response("GET", "/specific", {"found": True}, 200)

    response = client.sync_detailed("GET", "/unconfigured_path")
    assert response.status_code == 202
    assert response.data == {"default_payload": True}
    assert len(client.request_history) == 1


def test_fake_api_client_sync_detailed_fallback_response():
    client = FakeApiClient()  # No specific or default response
    response = client.sync_detailed("GET", "/anything")
    assert response.status_code == 404
    assert response.data == {"error": "Not Found"}
    assert len(client.request_history) == 1


def test_fake_api_client_sync_detailed_request_logging():
    client = FakeApiClient()
    payload = {"key": "value"}
    params = {"query": "test"}
    headers = {"Authorization": "Bearer token"}

    client.sync_detailed(
        "POST",
        "/log_me",
        json=payload,
        params=params,
        headers=headers,
        custom_kwarg="custom",
    )

    assert len(client.request_history) == 1
    request = client.request_history[0]
    assert request["method"] == "POST"
    assert request["url"] == "/log_me"
    assert request["json"] == payload
    assert request["data"] is None
    assert request["params"] == params
    assert request["headers"] == headers
    assert request["kwargs"] == {"custom_kwarg": "custom"}


def test_fake_api_client_convenience_methods():
    client = FakeApiClient()
    client.set_response("GET", "/get_path", {"method": "get"})
    client.set_response("POST", "/post_path", {"method": "post"})
    client.set_response("PUT", "/put_path", {"method": "put"})
    client.set_response("DELETE", "/delete_path", {"method": "delete"})

    assert client.get("/get_path").data == {"method": "get"}
    assert client.post("/post_path", json={}).data == {"method": "post"}
    assert client.put("/put_path", json={}).data == {"method": "put"}
    assert client.delete("/delete_path").data == {"method": "delete"}

    assert len(client.request_history) == 4
    assert client.request_history[0]["method"] == "GET"
    assert client.request_history[1]["method"] == "POST"
    assert client.request_history[2]["method"] == "PUT"
    assert client.request_history[3]["method"] == "DELETE"


def test_fake_api_client_clear_request_history():
    client = FakeApiClient()
    client.get("/test")
    assert len(client.request_history) == 1
    client.clear_request_history()
    assert len(client.request_history) == 0


def test_fake_api_client_reset():
    client = FakeApiClient()
    client.set_response("GET", "/test", {"data": "data"})
    client.set_default_response({"default": "default"})
    client.get("/test")

    client.reset()

    assert not client.responses
    assert not client.request_history
    assert client.default_response is None

    # After reset, should use fallback
    response = client.get("/test")
    assert response.status_code == 404


# Tests for FakeResponse
def test_fake_response_initialization():
    response = FakeResponse(
        status_code=200,
        data={"key": "value"},
        text="raw_text",
        headers={"X-Test": "TestVal"},
    )
    assert response.status_code == 200
    assert response.data == {"key": "value"}
    assert response._text == "raw_text"  # Direct access to check if text was passed
    assert response.headers == {"X-Test": "TestVal"}


def test_fake_response_json_method_success():
    response = FakeResponse(
        status_code=200,
        data={"key": "value"},
        headers={"Content-Type": "application/json"},
    )
    assert response.json() == {"key": "value"}


def test_fake_response_json_method_failure_content_type():
    response = FakeResponse(
        status_code=200, data={"key": "value"}, headers={"Content-Type": "text/plain"}
    )
    with pytest.raises(ValueError, match="Content-Type is not application/json"):
        response.json()


def test_fake_response_text_property_explicit_text():
    response = FakeResponse(status_code=200, text="explicit text here")
    assert response.text == "explicit text here"


def test_fake_response_text_property_from_data_str():
    response = FakeResponse(status_code=200, data="string data")
    assert response.text == "string data"


def test_fake_response_text_property_from_data_json_serializable():
    response = FakeResponse(status_code=200, data={"key": "value"})
    assert response.text == '{"key": "value"}'


def test_fake_response_text_property_from_data_non_serializable():
    class NonSerializable:
        pass

    data = NonSerializable()
    response = FakeResponse(status_code=200, data=data)
    assert response.text == str(data)


def test_fake_response_text_property_no_text_no_data():
    response = FakeResponse(status_code=204)  # No content
    assert response.text is None


def test_fake_response_content_property():
    response = FakeResponse(status_code=200, text="hello")
    assert response.content == b"hello"

    response_no_text = FakeResponse(status_code=204)
    assert response_no_text.content is None


def test_fake_response_raise_for_status_success():
    response = FakeResponse(status_code=200)
    try:
        response.raise_for_status()  # Should not raise
    except Exception:
        pytest.fail("raise_for_status raised an exception on a 200 status code")


@pytest.mark.parametrize("status", [400, 401, 403, 404, 500, 503])
def test_fake_response_raise_for_status_failure(status):
    response = FakeResponse(status_code=status)
    with pytest.raises(Exception, match=f"Fake HTTP Error: {status}"):
        response.raise_for_status()


def test_fake_response_parsed_property():
    data = {"parsed_data": True}
    response = FakeResponse(status_code=200, data=data)
    assert response.parsed == data
