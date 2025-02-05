from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigUpdateRequest")


@_attrs_define
class ConfigUpdateRequest:
    """Request to update a configuration entry.

    Attributes:
        value (Any): New configuration value
        description (Union[None, Unset, str]): Description of the configuration entry
        is_secret (Union[Unset, bool]): Whether this is a secret value Default: False.
    """

    value: Any
    description: Union[None, Unset, str] = UNSET
    is_secret: Union[Unset, bool] = False

    def to_dict(self) -> dict[str, Any]:
        value = self.value

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        is_secret = self.is_secret

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "value": value,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if is_secret is not UNSET:
            field_dict["is_secret"] = is_secret

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        value = d.pop("value")

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        is_secret = d.pop("is_secret", UNSET)

        config_update_request = cls(
            value=value,
            description=description,
            is_secret=is_secret,
        )

        return config_update_request
