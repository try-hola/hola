from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_responsestr import ApiResponsestr
from ...models.http_validation_error import HTTPValidationError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    name: Union[Unset, str] = "World",
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["name"] = name

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/hello/",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[ApiResponsestr, HTTPValidationError]]:
    if response.status_code == 200:
        response_200 = ApiResponsestr.from_dict(response.json())

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
) -> Response[Union[ApiResponsestr, HTTPValidationError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    name: Union[Unset, str] = "World",
) -> Response[Union[ApiResponsestr, HTTPValidationError]]:
    r"""Hello

     Simple hello endpoint to verify API functionality.

    Returns a greeting message with the provided name parameter.

    Args:
        request: The incoming HTTP request
        name: Name to include in the greeting message. Defaults to \"World\".

    Returns:
        ApiResponse[str]: A successful API response with greeting message.

    Args:
        name (Union[Unset, str]):  Default: 'World'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponsestr, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        name=name,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: Union[AuthenticatedClient, Client],
    name: Union[Unset, str] = "World",
) -> Optional[Union[ApiResponsestr, HTTPValidationError]]:
    r"""Hello

     Simple hello endpoint to verify API functionality.

    Returns a greeting message with the provided name parameter.

    Args:
        request: The incoming HTTP request
        name: Name to include in the greeting message. Defaults to \"World\".

    Returns:
        ApiResponse[str]: A successful API response with greeting message.

    Args:
        name (Union[Unset, str]):  Default: 'World'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponsestr, HTTPValidationError]
    """

    return sync_detailed(
        client=client,
        name=name,
    ).parsed


async def asyncio_detailed(
    *,
    client: Union[AuthenticatedClient, Client],
    name: Union[Unset, str] = "World",
) -> Response[Union[ApiResponsestr, HTTPValidationError]]:
    r"""Hello

     Simple hello endpoint to verify API functionality.

    Returns a greeting message with the provided name parameter.

    Args:
        request: The incoming HTTP request
        name: Name to include in the greeting message. Defaults to \"World\".

    Returns:
        ApiResponse[str]: A successful API response with greeting message.

    Args:
        name (Union[Unset, str]):  Default: 'World'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[ApiResponsestr, HTTPValidationError]]
    """

    kwargs = _get_kwargs(
        name=name,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: Union[AuthenticatedClient, Client],
    name: Union[Unset, str] = "World",
) -> Optional[Union[ApiResponsestr, HTTPValidationError]]:
    r"""Hello

     Simple hello endpoint to verify API functionality.

    Returns a greeting message with the provided name parameter.

    Args:
        request: The incoming HTTP request
        name: Name to include in the greeting message. Defaults to \"World\".

    Returns:
        ApiResponse[str]: A successful API response with greeting message.

    Args:
        name (Union[Unset, str]):  Default: 'World'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[ApiResponsestr, HTTPValidationError]
    """

    return (
        await asyncio_detailed(
            client=client,
            name=name,
        )
    ).parsed
