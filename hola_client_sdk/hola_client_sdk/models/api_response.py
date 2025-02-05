from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error import ApiError


T = TypeVar("T", bound="ApiResponse")


@_attrs_define
class ApiResponse:
    """Generic API response wrapper.

    A standardized response structure for all API endpoints that includes
    success status, response data, and error information when applicable.
    This model is used consistently across all API endpoints to provide
    a uniform interface for success and error handling.

    The generic type parameter T allows for strong typing of the response data
    based on the specific endpoint's return type.

    Attributes:
        success: Boolean indicating if the request was successful.
        data: Optional response data of generic type T when success is True.
        error: Optional error information when success is False.

    Example:
        # Success response with string data
        success_response = ApiResponse(success=True, data="Operation completed")

        # Error response
        error_response = ApiResponse(
            success=False,
            error=ApiError(code="NOT_FOUND", message="Resource not found")
        )

        Attributes:
            success (bool):
            data (Union[Any, None, Unset]):
            error (Union['ApiError', None, Unset]):
    """

    success: bool
    data: Union[Any, None, Unset] = UNSET
    error: Union["ApiError", None, Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_error import ApiError

        success = self.success

        data: Union[Any, None, Unset]
        if isinstance(self.data, Unset):
            data = UNSET
        else:
            data = self.data

        error: Union[None, Unset, dict[str, Any]]
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, ApiError):
            error = self.error.to_dict()
        else:
            error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "success": success,
            }
        )
        if data is not UNSET:
            field_dict["data"] = data
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error import ApiError

        d = dict(src_dict)
        success = d.pop("success")

        def _parse_data(data: object) -> Union[Any, None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[Any, None, Unset], data)

        data = _parse_data(d.pop("data", UNSET))

        def _parse_error(data: object) -> Union["ApiError", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = ApiError.from_dict(data)

                return error_type_0
            except:  # noqa: E722
                pass
            return cast(Union["ApiError", None, Unset], data)

        error = _parse_error(d.pop("error", UNSET))

        api_response = cls(
            success=success,
            data=data,
            error=error,
        )

        api_response.additional_properties = d
        return api_response

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
