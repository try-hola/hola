from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.file_info import FileInfo


T = TypeVar("T", bound="FileListResponse")


@_attrs_define
class FileListResponse:
    """Response model for file listing.

    Attributes:
        files (Union[Unset, list['FileInfo']]): List of files
        count (Union[Unset, int]): Total number of files Default: 0.
        total_size_bytes (Union[Unset, int]): Total size in bytes Default: 0.
    """

    files: Union[Unset, list["FileInfo"]] = UNSET
    count: Union[Unset, int] = 0
    total_size_bytes: Union[Unset, int] = 0
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        files: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.files, Unset):
            files = []
            for files_item_data in self.files:
                files_item = files_item_data.to_dict()
                files.append(files_item)

        count = self.count

        total_size_bytes = self.total_size_bytes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if files is not UNSET:
            field_dict["files"] = files
        if count is not UNSET:
            field_dict["count"] = count
        if total_size_bytes is not UNSET:
            field_dict["total_size_bytes"] = total_size_bytes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.file_info import FileInfo

        d = dict(src_dict)
        files = []
        _files = d.pop("files", UNSET)
        for files_item_data in _files or []:
            files_item = FileInfo.from_dict(files_item_data)

            files.append(files_item)

        count = d.pop("count", UNSET)

        total_size_bytes = d.pop("total_size_bytes", UNSET)

        file_list_response = cls(
            files=files,
            count=count,
            total_size_bytes=total_size_bytes,
        )

        file_list_response.additional_properties = d
        return file_list_response

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
