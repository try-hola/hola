import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

T = TypeVar("T", bound="FileInfo")


@_attrs_define
class FileInfo:
    """Information about an application file.

    Attributes:
        path (str): File path relative to app root
        size (int): Size in bytes
        modified_at (datetime.datetime): Last modification timestamp
        content_type (str): Content type of the file
    """

    path: str
    size: int
    modified_at: datetime.datetime
    content_type: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        size = self.size

        modified_at = self.modified_at.isoformat()

        content_type = self.content_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "path": path,
                "size": size,
                "modified_at": modified_at,
                "content_type": content_type,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        path = d.pop("path")

        size = d.pop("size")

        modified_at = isoparse(d.pop("modified_at"))

        content_type = d.pop("content_type")

        file_info = cls(
            path=path,
            size=size,
            modified_at=modified_at,
            content_type=content_type,
        )

        file_info.additional_properties = d
        return file_info

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
