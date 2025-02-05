from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_response_dictstr_any import ApiResponseDictstrAny
from ...models.http_validation_error import HTTPValidationError
from ...models.metrics_clear_request import MetricsClearRequest
from ...types import Response


def _get_kwargs(
    app_name: str,
    *,
    body: Union["MetricsClearRequest", None],
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": f"/api/apps/{app_name}/metrics",
    }

    _body: Union[None, dict[str, Any]]
    if isinstance(body, MetricsClearRequest):
        _body = body.to_dict()
    else:
        _body = body

    _kwargs["json"] = _body
    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponseDictstrAny.from_dict(response.json())

        return response_200
    if response.status_code == 422:
        response_422 = HTTPValidationError.from_dict(response.json())

        return response_422
    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: Union["MetricsClearRequest", None],
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Clear Metrics

     Clear metrics for an application.

    Args:
        app_name (str):
        body (Union['MetricsClearRequest', None]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseDictstrAny, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: Union["MetricsClearRequest", None],
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Clear Metrics

     Clear metrics for an application.

    Args:
        app_name (str):
        body (Union['MetricsClearRequest', None]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseDictstrAny, HTTPValidationError]
    """

    return sync_detailed(
        app_name=app_name,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: Union["MetricsClearRequest", None],
) -> Response[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Clear Metrics

     Clear metrics for an application.

    Args:
        app_name (str):
        body (Union['MetricsClearRequest', None]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponseDictstrAny, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        app_name=app_name,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    app_name: str,
    *,
    client: AuthenticatedClient,
    body: Union["MetricsClearRequest", None],
) -> Optional[Union[ApiResponseDictstrAny, HTTPValidationError]]:
    """Clear Metrics

     Clear metrics for an application.

    Args:
        app_name (str):
        body (Union['MetricsClearRequest', None]):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponseDictstrAny, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            app_name=app_name,
            client=client,
            body=body,
        )
    ).parsed
