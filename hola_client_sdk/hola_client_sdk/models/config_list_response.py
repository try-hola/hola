from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_entry import ConfigEntry


T = TypeVar("T", bound="ConfigListResponse")


@_attrs_define
class ConfigListResponse:
    """Response containing list of configuration entries.

    Attributes:
        entries (list['ConfigEntry']): Configuration entries
        count (int): Total number of entries
        success (Union[Unset, bool]): Whether the operation was successful Default: True.
    """

    entries: list["ConfigEntry"]
    count: int
    success: Union[Unset, bool] = True

    def to_dict(self) -> dict[str, Any]:
        entries = []
        for entries_item_data in self.entries:
            entries_item = entries_item_data.to_dict()
            entries.append(entries_item)

        count = self.count

        success = self.success

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "entries": entries,
                "count": count,
            }
        )
        if success is not UNSET:
            field_dict["success"] = success

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_entry import ConfigEntry

        d = dict(src_dict)
        entries = []
        _entries = d.pop("entries")
        for entries_item_data in _entries:
            entries_item = ConfigEntry.from_dict(entries_item_data)

            entries.append(entries_item)

        count = d.pop("count")

        success = d.pop("success", UNSET)

        config_list_response = cls(
            entries=entries,
            count=count,
            success=success,
        )

        return config_list_response
