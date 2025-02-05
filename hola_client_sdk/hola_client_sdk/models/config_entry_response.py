from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_entry import ConfigEntry


T = TypeVar("T", bound="ConfigEntryResponse")


@_attrs_define
class ConfigEntryResponse:
    """Response containing a single configuration entry.

    Attributes:
        entry (ConfigEntry): A single configuration entry.
        success (Union[Unset, bool]): Whether the operation was successful Default: True.
    """

    entry: "ConfigEntry"
    success: Union[Unset, bool] = True

    def to_dict(self) -> dict[str, Any]:
        entry = self.entry.to_dict()

        success = self.success

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "entry": entry,
            }
        )
        if success is not UNSET:
            field_dict["success"] = success

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_entry import ConfigEntry

        d = dict(src_dict)
        entry = ConfigEntry.from_dict(d.pop("entry"))

        success = d.pop("success", UNSET)

        config_entry_response = cls(
            entry=entry,
            success=success,
        )

        return config_entry_response
