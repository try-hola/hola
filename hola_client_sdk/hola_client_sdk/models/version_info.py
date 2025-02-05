import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="VersionInfo")


@_attrs_define
class VersionInfo:
    """Server version information.

    Attributes:
        version (str): Server version number
        python_version (str): Python version
        build_id (Union[None, Unset, str]): Build identifier
        build_date (Union[None, Unset, datetime.datetime]): Build timestamp
        git_commit (Union[None, Unset, str]): Git commit hash
    """

    version: str
    python_version: str
    build_id: Union[None, Unset, str] = UNSET
    build_date: Union[None, Unset, datetime.datetime] = UNSET
    git_commit: Union[None, Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        python_version = self.python_version

        build_id: Union[None, Unset, str]
        if isinstance(self.build_id, Unset):
            build_id = UNSET
        else:
            build_id = self.build_id

        build_date: Union[None, Unset, str]
        if isinstance(self.build_date, Unset):
            build_date = UNSET
        elif isinstance(self.build_date, datetime.datetime):
            build_date = self.build_date.isoformat()
        else:
            build_date = self.build_date

        git_commit: Union[None, Unset, str]
        if isinstance(self.git_commit, Unset):
            git_commit = UNSET
        else:
            git_commit = self.git_commit

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "version": version,
                "python_version": python_version,
            }
        )
        if build_id is not UNSET:
            field_dict["build_id"] = build_id
        if build_date is not UNSET:
            field_dict["build_date"] = build_date
        if git_commit is not UNSET:
            field_dict["git_commit"] = git_commit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        python_version = d.pop("python_version")

        def _parse_build_id(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        build_id = _parse_build_id(d.pop("build_id", UNSET))

        def _parse_build_date(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                build_date_type_0 = isoparse(data)

                return build_date_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        build_date = _parse_build_date(d.pop("build_date", UNSET))

        def _parse_git_commit(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        git_commit = _parse_git_commit(d.pop("git_commit", UNSET))

        version_info = cls(
            version=version,
            python_version=python_version,
            build_id=build_id,
            build_date=build_date,
            git_commit=git_commit,
        )

        version_info.additional_properties = d
        return version_info

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
