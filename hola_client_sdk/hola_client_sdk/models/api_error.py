from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error_details_type_0 import ApiErrorDetailsType0


T = TypeVar("T", bound="ApiError")


@_attrs_define
class ApiError:
    """API error representation.

    A standardized error model for API responses containing error code,
    human-readable message, and optional detailed information. This model
    is used consistently throughout the application to ensure uniform
    error reporting and handling.

    Error codes are typically uppercase strings like "NOT_FOUND" or
    "VALIDATION_ERROR" that identify the category of error. These can
    be used by client applications for programmatic error handling.

    Attributes:
        code: A string error code that identifies the error type.
        message: A human-readable error message describing the issue.
        details: Optional additional context information about the error,
                such as specific fields that failed validation or
                additional error context.

    Example:
        # Create an API error for failed validation
        validation_error = ApiError(
            code="VALIDATION_ERROR",
            message="Invalid input data",
            details={"fields": {"username": ["Must be at least 3 characters"]}}
        )

        Attributes:
            code (str):
            message (str):
            details (Union['ApiErrorDetailsType0', None, Unset]):
    """

    code: str
    message: str
    details: Union["ApiErrorDetailsType0", None, Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_error_details_type_0 import ApiErrorDetailsType0

        code = self.code

        message = self.message

        details: Union[None, Unset, dict[str, Any]]
        if isinstance(self.details, Unset):
            details = UNSET
        elif isinstance(self.details, ApiErrorDetailsType0):
            details = self.details.to_dict()
        else:
            details = self.details

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error_details_type_0 import ApiErrorDetailsType0

        d = dict(src_dict)
        code = d.pop("code")

        message = d.pop("message")

        def _parse_details(data: object) -> Union["ApiErrorDetailsType0", None, Unset]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                details_type_0 = ApiErrorDetailsType0.from_dict(data)

                return details_type_0
            except:  # noqa: E722
                pass
            return cast(Union["ApiErrorDetailsType0", None, Unset], data)

        details = _parse_details(d.pop("details", UNSET))

        api_error = cls(
            code=code,
            message=message,
            details=details,
        )

        api_error.additional_properties = d
        return api_error

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
